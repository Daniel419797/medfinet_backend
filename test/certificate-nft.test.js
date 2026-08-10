const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CERTIFICATE_NFT_ASSET_NAME,
  CERTIFICATE_NFT_UNIT_NAME,
  certificateNftOutboxData,
  createCertificateNftService,
  inspectCertificateNftReceipt,
} = require('../services/certificateNftService');
const {
  createCertificateNftQueueService,
  proofPartsFromProofId,
} = require('../services/certificateNftQueueService');
const { EVENT_TYPES } = require('../services/blockchain/eventTypes');

const fingerprint = 'ab'.repeat(32);

function mintInput() {
  return {
    organizationId: 'org-1',
    immunizationId: 'imm-1',
    proofId: `immunization-recorded:v1:imm-1:${fingerprint}`,
    fingerprintVersion: 1,
    fingerprint,
  };
}

function confirmedReceipt() {
  return {
    id: 'nft-receipt-1',
    ...mintInput(),
    network: 'testnet',
    status: 'CONFIRMED',
    assetId: 444n,
    txId: 'NFT-TX-1',
    blockHeight: 88n,
    creatorAddress: 'PLATFORM-ACCOUNT',
    signedTransaction: null,
    confirmedAt: new Date('2026-08-10T12:00:00.000Z'),
  };
}

function memoryRepository() {
  let stored = null;
  return {
    get stored() {
      return stored;
    },
    async findByProofId() {
      return stored;
    },
    async createPending(intent) {
      if (stored) return { inserted: false, receipt: stored };
      stored = {
        id: 'nft-receipt-1',
        ...intent,
        status: 'PENDING',
        assetId: null,
        blockHeight: null,
        confirmedAt: null,
      };
      return { inserted: true, receipt: stored };
    },
    async confirm(_organizationId, _proofId, txId, confirmation) {
      if (!stored || stored.txId !== txId || stored.status !== 'PENDING') {
        return { updated: false, receipt: stored };
      }
      stored = {
        ...stored,
        ...confirmation,
        status: 'CONFIRMED',
        signedTransaction: null,
      };
      return { updated: true, receipt: stored };
    },
  };
}

test('certificate NFT outbox payload contains only proof identifiers and a fingerprint', () => {
  const request = certificateNftOutboxData(
    { id: 'imm-1', organizationId: 'org-1' },
    {
      aggregateId: 'imm-1',
      anchorId: mintInput().proofId,
      fingerprint,
      fingerprintVersion: 1,
    },
  );

  assert.equal(request.eventType, 'BLOCKCHAIN_CERTIFICATE_NFT_REQUESTED');
  assert.ok(request.idempotencyKey.endsWith(fingerprint));
  assert.deepEqual(Object.keys(request.payload).sort(), [
    'fingerprint',
    'fingerprintVersion',
    'immunizationId',
    'proofId',
    'tenantId',
  ]);
  const serialized = JSON.stringify(request);
  for (const clinicalValue of [
    'James New',
    'BCG',
    '2025-08-09',
    'Dennis Primary Health Centre',
    'MALE',
  ]) {
    assert.equal(serialized.includes(clinicalValue), false);
  }
});

test('a changed fingerprint produces a distinct NFT outbox idempotency key', () => {
  const first = certificateNftOutboxData(
    { id: 'imm-1', organizationId: 'org-1' },
    {
      aggregateId: 'imm-1',
      anchorId: mintInput().proofId,
      fingerprint,
      fingerprintVersion: 1,
    },
  );
  const secondFingerprint = 'cd'.repeat(32);
  const second = certificateNftOutboxData(
    { id: 'imm-1', organizationId: 'org-1' },
    {
      aggregateId: 'imm-1',
      anchorId: `immunization-recorded:v1:imm-1:${secondFingerprint}`,
      fingerprint: secondFingerprint,
      fingerprintVersion: 1,
    },
  );

  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test('persists the deterministic mint intent before chain submission and replays idempotently', async () => {
  let preparedCount = 0;
  let submittedCount = 0;
  let adapterInput;
  const repository = memoryRepository();
  const adapter = {
    networkId: 'testnet',
    async prepareCertificateNft(input) {
      preparedCount += 1;
      adapterInput = input;
      return {
        txId: 'NFT-TX-1',
        signedTransaction: Buffer.from('same-signed-transaction'),
        network: 'testnet',
        creatorAddress: 'PLATFORM-ACCOUNT',
      };
    },
    async submitPreparedCertificateNft(prepared) {
      submittedCount += 1;
      assert.equal(prepared.txId, 'NFT-TX-1');
      return {
        assetId: 444n,
        txId: 'NFT-TX-1',
        blockHeight: 88n,
        network: 'testnet',
        creatorAddress: 'PLATFORM-ACCOUNT',
      };
    },
    async getTransaction() {
      throw new Error('confirmed receipts must not be re-queried during mint replay');
    },
  };
  const service = createCertificateNftService(adapter, repository, {
    now: () => new Date('2026-08-10T12:00:00.000Z'),
  });

  const first = await service.mint(mintInput());
  const second = await service.mint(mintInput());

  assert.equal(preparedCount, 1);
  assert.equal(submittedCount, 1);
  assert.equal(first.status, 'CONFIRMED');
  assert.equal(first.assetId, 444n);
  assert.equal(second.assetId, 444n);
  assert.equal(adapterInput.assetName, CERTIFICATE_NFT_ASSET_NAME);
  assert.equal(adapterInput.unitName, CERTIFICATE_NFT_UNIT_NAME);
  assert.deepEqual(adapterInput.metadataHash, Buffer.from(fingerprint, 'hex'));
  assert.equal(repository.stored.signedTransaction, null);
});

test('a retry resumes the same pending transaction instead of preparing a second asset', async () => {
  const repository = memoryRepository();
  await repository.createPending({
    ...mintInput(),
    network: 'testnet',
    txId: 'NFT-TX-1',
    creatorAddress: 'PLATFORM-ACCOUNT',
    signedTransaction: Buffer.from('same-signed-transaction').toString('base64'),
  });
  let prepareCount = 0;
  let submitCount = 0;
  const adapter = {
    networkId: 'testnet',
    async prepareCertificateNft() {
      prepareCount += 1;
      throw new Error('must not prepare a new transaction for an existing intent');
    },
    async getTransaction() {
      return {
        lookupStatus: 'UNAVAILABLE',
        unavailableReason: 'TRANSACTION_NOT_RETAINED_OR_NOT_FOUND',
      };
    },
    async submitPreparedCertificateNft(prepared) {
      submitCount += 1;
      assert.equal(prepared.txId, 'NFT-TX-1');
      assert.deepEqual(prepared.signedTransaction, Buffer.from('same-signed-transaction'));
      return {
        assetId: 444n,
        txId: 'NFT-TX-1',
        blockHeight: 88n,
        network: 'testnet',
        creatorAddress: 'PLATFORM-ACCOUNT',
      };
    },
  };
  const service = createCertificateNftService(adapter, repository, {
    now: () => new Date('2026-08-10T12:00:00.000Z'),
  });

  const result = await service.mint(mintInput());

  assert.equal(prepareCount, 0);
  assert.equal(submitCount, 1);
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.assetId, 444n);
});

test('reconciles a confirmed pending mint by transaction ID without resubmission', async () => {
  const repository = memoryRepository();
  await repository.createPending({
    ...mintInput(),
    network: 'testnet',
    txId: 'NFT-TX-1',
    creatorAddress: 'PLATFORM-ACCOUNT',
    signedTransaction: Buffer.from('same-signed-transaction').toString('base64'),
  });
  let submittedCount = 0;
  const adapter = {
    networkId: 'testnet',
    async getTransaction() {
      return {
        lookupStatus: 'FOUND',
        txId: 'NFT-TX-1',
        type: 'acfg',
        sender: 'PLATFORM-ACCOUNT',
        signer: 'PLATFORM-ACCOUNT',
        createdAssetId: 444n,
        confirmed: true,
        confirmedRound: 88n,
      };
    },
    async submitPreparedCertificateNft() {
      submittedCount += 1;
      throw new Error('must not resubmit a transaction already confirmed on chain');
    },
  };
  const service = createCertificateNftService(adapter, repository, {
    now: () => new Date('2026-08-10T12:00:00.000Z'),
  });

  const result = await service.mint(mintInput());

  assert.equal(submittedCount, 0);
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.assetId, 444n);
});

test('verifies the immutable 1-of-1 asset and its exact mint transaction', async () => {
  const receipt = confirmedReceipt();
  const adapter = {
    networkId: 'testnet',
    networkName: 'Algorand TestNet',
    platformAccount: { addr: 'PLATFORM-ACCOUNT' },
    async getAsset(assetId) {
      return {
        lookupStatus: 'FOUND',
        assetId,
        creator: 'PLATFORM-ACCOUNT',
        total: 1n,
        decimals: 0,
        defaultFrozen: false,
        unitName: CERTIFICATE_NFT_UNIT_NAME,
        assetName: CERTIFICATE_NFT_ASSET_NAME,
        url: null,
        metadataHash: Buffer.from(fingerprint, 'hex'),
        manager: null,
        reserve: null,
        freeze: null,
        clawback: null,
      };
    },
    async getTransaction() {
      return {
        lookupStatus: 'FOUND',
        txId: 'NFT-TX-1',
        type: 'acfg',
        sender: 'PLATFORM-ACCOUNT',
        signer: 'PLATFORM-ACCOUNT',
        createdAssetId: 444n,
        confirmed: true,
        confirmedRound: 88n,
      };
    },
    getExplorerUrl(txId) {
      return `https://example.test/tx/${txId}`;
    },
  };

  const evidence = await inspectCertificateNftReceipt(receipt, adapter, {
    ...mintInput(),
    network: 'testnet',
  });

  assert.equal(evidence.status, 'CONFIRMED');
  assert.equal(evidence.verified, true);
  assert.equal(evidence.assetId, '444');
  assert.equal(evidence.receiptIntegrity, true);
  assert.equal(evidence.transactionIntegrity, true);
  assert.equal(evidence.assetIntegrity, true);
  assert.equal(evidence.metadataIntegrity, true);
  assert.equal(evidence.supplyIntegrity, true);
  assert.equal(evidence.immutableIntegrity, true);
  assert.equal(evidence.chainConfirmed, true);
});

test('reports an intact but unconfirmed mint separately from a mismatch', async () => {
  const receipt = confirmedReceipt();
  const adapter = {
    networkId: 'testnet',
    networkName: 'Algorand TestNet',
    platformAccount: { addr: 'PLATFORM-ACCOUNT' },
    async getAsset(assetId) {
      return {
        lookupStatus: 'FOUND',
        assetId,
        creator: 'PLATFORM-ACCOUNT',
        total: 1n,
        decimals: 0,
        defaultFrozen: false,
        unitName: CERTIFICATE_NFT_UNIT_NAME,
        assetName: CERTIFICATE_NFT_ASSET_NAME,
        url: null,
        metadataHash: Buffer.from(fingerprint, 'hex'),
        manager: null,
        reserve: null,
        freeze: null,
        clawback: null,
      };
    },
    async getTransaction() {
      return {
        lookupStatus: 'FOUND',
        txId: 'NFT-TX-1',
        type: 'acfg',
        sender: 'PLATFORM-ACCOUNT',
        signer: 'PLATFORM-ACCOUNT',
        createdAssetId: 444n,
        confirmed: false,
        confirmedRound: 0n,
      };
    },
    getExplorerUrl: () => 'https://example.test/tx/NFT-TX-1',
  };

  const evidence = await inspectCertificateNftReceipt(receipt, adapter, {
    ...mintInput(),
    network: 'testnet',
  });

  assert.equal(evidence.status, 'UNCONFIRMED');
  assert.equal(evidence.verified, false);
  assert.equal(evidence.assetIntegrity, true);
  assert.equal(evidence.transactionIntegrity, true);
});

test('reports mismatch if the public asset metadata hash is not the vaccination fingerprint', async () => {
  const receipt = confirmedReceipt();
  const adapter = {
    networkId: 'testnet',
    networkName: 'Algorand TestNet',
    platformAccount: { addr: 'PLATFORM-ACCOUNT' },
    async getAsset(assetId) {
      return {
        lookupStatus: 'FOUND',
        assetId,
        creator: 'PLATFORM-ACCOUNT',
        total: 1n,
        decimals: 0,
        defaultFrozen: false,
        unitName: CERTIFICATE_NFT_UNIT_NAME,
        assetName: CERTIFICATE_NFT_ASSET_NAME,
        url: null,
        metadataHash: Buffer.from('cd'.repeat(32), 'hex'),
        manager: null,
        reserve: null,
        freeze: null,
        clawback: null,
      };
    },
    async getTransaction() {
      return {
        lookupStatus: 'FOUND',
        txId: 'NFT-TX-1',
        type: 'acfg',
        sender: 'PLATFORM-ACCOUNT',
        signer: 'PLATFORM-ACCOUNT',
        createdAssetId: 444n,
        confirmed: true,
        confirmedRound: 88n,
      };
    },
    getExplorerUrl: () => 'https://example.test/tx/NFT-TX-1',
  };

  const evidence = await inspectCertificateNftReceipt(receipt, adapter, {
    ...mintInput(),
    network: 'testnet',
  });

  assert.equal(evidence.status, 'MISMATCH');
  assert.equal(evidence.verified, false);
  assert.equal(evidence.metadataIntegrity, false);
  assert.equal(evidence.assetIntegrity, false);
});

test('reports a persisted mint intent as pending without claiming asset verification', async () => {
  const pending = {
    id: 'nft-receipt-pending',
    ...mintInput(),
    network: 'testnet',
    status: 'PENDING',
    assetId: null,
    txId: 'NFT-TX-1',
    blockHeight: null,
    creatorAddress: 'PLATFORM-ACCOUNT',
    signedTransaction: 'c2lnbmVk',
    confirmedAt: null,
  };
  const adapter = {
    networkId: 'testnet',
    networkName: 'Algorand TestNet',
    getExplorerUrl: () => 'https://example.test/tx/NFT-TX-1',
  };

  const evidence = await inspectCertificateNftReceipt(pending, adapter, {
    ...mintInput(),
    network: 'testnet',
  });

  assert.equal(evidence.status, 'PENDING');
  assert.equal(evidence.receiptIntegrity, true);
  assert.equal(evidence.verified, false);
  assert.equal(evidence.assetId, null);
});

function fakeQueueDatabase(overrides = {}) {
  const calls = [];
  const transaction = {
    async $executeRawUnsafe() {},
    immunizationRecord: {
      async findFirst() {
        return { id: 'imm-1' };
      },
    },
    clinicalAmendment: {
      async findFirst() {
        return { immunizationId: 'imm-1' };
      },
    },
    outboxEvent: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        calls.push(data);
        return { id: 'nft-event-1', status: 'PENDING', ...data };
      },
    },
    ...overrides,
  };
  return {
    calls,
    database: {
      async $transaction(operation) {
        return operation(transaction);
      },
    },
    transaction,
  };
}

test('queues the NFT immediately after a recorded immunization anchor confirms', async () => {
  const setup = fakeQueueDatabase();
  const queue = createCertificateNftQueueService(setup.database);
  const event = {
    aggregateId: 'imm-1',
    payload: {
      eventCode: EVENT_TYPES.IMMUNIZATION_RECORD.code,
      anchorId: mintInput().proofId,
      tenantId: 'org-1',
    },
  };

  const result = await queue.queueFromAnchorEvent({ organizationId: 'org-1' }, event);

  assert.equal(result.queued, true);
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0].eventType, 'BLOCKCHAIN_CERTIFICATE_NFT_REQUESTED');
  assert.equal(setup.calls[0].payload.immunizationId, 'imm-1');
  assert.equal(setup.calls[0].payload.fingerprint, fingerprint);
  assert.equal(setup.calls[0].payload.fingerprintVersion, 1);
});

test('resolves an amended proof back to its immunization before queuing the replacement NFT', async () => {
  const setup = fakeQueueDatabase();
  const queue = createCertificateNftQueueService(setup.database);
  const amendedProof = `immunization-amended:v1:amendment-1:${'ef'.repeat(32)}`;
  const event = {
    aggregateId: 'amendment-1',
    payload: {
      eventCode: EVENT_TYPES.IMMUNIZATION_AMEND.code,
      anchorId: amendedProof,
      tenantId: 'org-1',
    },
  };

  const result = await queue.queueFromAnchorEvent({ organizationId: 'org-1' }, event);

  assert.equal(result.queued, true);
  assert.equal(result.immunizationId, 'imm-1');
  assert.equal(setup.calls[0].aggregateId, 'amendment-1');
  assert.equal(setup.calls[0].payload.immunizationId, 'imm-1');
  assert.equal(setup.calls[0].payload.proofId, amendedProof);
});

test('rejects proof IDs that claim a different fingerprint schema version', () => {
  assert.throws(
    () => proofPartsFromProofId(`immunization-recorded:v2:imm-1:${fingerprint}`),
    (error) => error.code === 'CERTIFICATE_NFT_PROOF_VERSION_UNSUPPORTED',
  );
});
