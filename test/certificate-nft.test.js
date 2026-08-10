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
    assetId: 444n,
    txId: 'NFT-TX-1',
    blockHeight: 88n,
    creatorAddress: 'PLATFORM-ACCOUNT',
    confirmedAt: new Date('2026-08-10T12:00:00.000Z'),
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

test('mints a certificate NFT once and returns the persisted receipt on replay', async () => {
  let minted = 0;
  let stored = null;
  let adapterInput;
  const adapter = {
    networkId: 'testnet',
    async mintCertificateNft(input) {
      minted += 1;
      adapterInput = input;
      return {
        assetId: 444n,
        txId: 'NFT-TX-1',
        blockHeight: 88n,
        network: 'testnet',
        creatorAddress: 'PLATFORM-ACCOUNT',
      };
    },
  };
  const repository = {
    async findByProofId() {
      return stored;
    },
    async save(receipt) {
      stored = { id: 'nft-receipt-1', ...receipt };
      return stored;
    },
  };
  const service = createCertificateNftService(adapter, repository, {
    now: () => new Date('2026-08-10T12:00:00.000Z'),
  });

  const first = await service.mint(mintInput());
  const second = await service.mint(mintInput());

  assert.equal(minted, 1);
  assert.equal(first.assetId, 444n);
  assert.equal(second.assetId, 444n);
  assert.equal(adapterInput.assetName, CERTIFICATE_NFT_ASSET_NAME);
  assert.equal(adapterInput.unitName, CERTIFICATE_NFT_UNIT_NAME);
  assert.deepEqual(adapterInput.metadataHash, Buffer.from(fingerprint, 'hex'));
  assert.deepEqual(Object.keys(adapterInput).sort(), ['assetName', 'metadataHash', 'unitName']);
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
