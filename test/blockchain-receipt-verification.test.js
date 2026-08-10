const assert = require('node:assert/strict');
const test = require('node:test');
const BlockchainAnchorService = require('../services/blockchain/BlockchainAnchorService');
const { buildNote } = require('../services/blockchain/eventTypes');
const {
  inspectAnchorReceipt,
} = require('../services/blockchain/receiptVerification');

function receiptFromMaterial(material) {
  return {
    anchorId: 'immunization:record-1:fingerprint',
    eventCode: 0x09,
    tenantId: 'org-1',
    txId: 'TX-1',
    timestamp: material.timestamp,
    nonce: material.nonce,
    hash: material.hash,
  };
}

function adapterWithNote(note) {
  return {
    platformAccount: 'PLATFORM-ACCOUNT',
    networkName: 'Algorand TestNet',
    networkId: 'testnet',
    async getTransaction() {
      return {
        txId: 'TX-1',
        confirmed: true,
        confirmedRound: 42n,
        note,
        type: 'pay',
        sender: 'PLATFORM-ACCOUNT',
        signer: 'PLATFORM-ACCOUNT',
        receiver: 'PLATFORM-ACCOUNT',
        amount: 0n,
        rekeyTo: null,
        closeRemainderTo: null,
      };
    },
    getExplorerUrl(txId) {
      return `https://testnet.explorer.perawallet.app/tx/${txId}`;
    },
  };
}

function expectedClaim() {
  return {
    anchorId: 'immunization:record-1:fingerprint',
    eventCode: 0x09,
    tenantId: 'org-1',
  };
}

test('verifies the receipt hash against the confirmed Algorand transaction note', async () => {
  const material = buildNote(
    0x09,
    'org-1',
    'immunization:record-1:fingerprint',
  );
  const evidence = await inspectAnchorReceipt(
    receiptFromMaterial(material),
    adapterWithNote(material.note),
    expectedClaim(),
  );

  assert.equal(evidence.hashIntegrity, true);
  assert.equal(evidence.noteIntegrity, true);
  assert.equal(evidence.chainConfirmed, true);
  assert.equal(evidence.verified, true);
});

test('rejects a confirmed transaction whose Algorand note does not match', async () => {
  const material = buildNote(
    0x09,
    'org-1',
    'immunization:record-1:fingerprint',
  );
  const tampered = Buffer.from(material.note);
  tampered[tampered.length - 1] ^= 0xff;
  const evidence = await inspectAnchorReceipt(
    receiptFromMaterial(material),
    adapterWithNote(tampered),
    expectedClaim(),
  );

  assert.equal(evidence.hashIntegrity, true);
  assert.equal(evidence.noteIntegrity, false);
  assert.equal(evidence.verified, false);
});

test('reports a missing Algorand transaction as an integrity mismatch', async () => {
  const material = buildNote(
    0x09,
    'org-1',
    'immunization:record-1:fingerprint',
  );
  const adapter = adapterWithNote(material.note);
  adapter.getTransaction = async () => null;

  const evidence = await inspectAnchorReceipt(
    receiptFromMaterial(material),
    adapter,
    expectedClaim(),
  );

  assert.equal(evidence.hashIntegrity, true);
  assert.equal(evidence.noteIntegrity, false);
  assert.equal(evidence.chainConfirmed, false);
  assert.equal(evidence.verified, false);
});

test('preserves note integrity while an Algorand transaction is unconfirmed', async () => {
  const material = buildNote(
    0x09,
    'org-1',
    'immunization:record-1:fingerprint',
  );
  const adapter = adapterWithNote(material.note);
  const confirmedTransaction = await adapter.getTransaction();
  adapter.getTransaction = async () => ({
    ...confirmedTransaction,
    confirmed: false,
    confirmedRound: 0n,
  });

  const evidence = await inspectAnchorReceipt(
    receiptFromMaterial(material),
    adapter,
    expectedClaim(),
  );

  assert.equal(evidence.hashIntegrity, true);
  assert.equal(evidence.noteIntegrity, true);
  assert.equal(evidence.chainConfirmed, false);
  assert.equal(evidence.verified, false);
});

test('rejects a malformed receipt hash without querying Algorand', async () => {
  const material = buildNote(
    0x09,
    'org-1',
    'immunization:record-1:fingerprint',
  );
  let queried = false;
  const adapter = adapterWithNote(material.note);
  adapter.getTransaction = async () => {
    queried = true;
    return { confirmed: true, note: material.note };
  };

  const evidence = await inspectAnchorReceipt(
    { ...receiptFromMaterial(material), hash: 'not-a-32-byte-hash' },
    adapter,
    expectedClaim(),
  );

  assert.equal(queried, false);
  assert.equal(evidence.noteIntegrity, false);
  assert.equal(evidence.chainConfirmed, false);
  assert.equal(evidence.verified, false);
});

test('rejects a receipt that is not bound to the requested tenant and event', async () => {
  const material = buildNote(0x09, 'org-1', 'immunization:record-1:fingerprint');
  let queried = false;
  const adapter = adapterWithNote(material.note);
  adapter.getTransaction = async () => {
    queried = true;
    return null;
  };

  const evidence = await inspectAnchorReceipt(
    receiptFromMaterial(material),
    adapter,
    { ...expectedClaim(), tenantId: 'org-2' },
  );

  assert.equal(queried, false);
  assert.equal(evidence.receiptIntegrity, false);
  assert.equal(evidence.verified, false);
});

test('rejects a copied note on a transaction not signed by the platform account', async () => {
  const material = buildNote(0x09, 'org-1', 'immunization:record-1:fingerprint');
  const adapter = adapterWithNote(material.note);
  const transaction = await adapter.getTransaction();
  adapter.getTransaction = async () => ({
    ...transaction,
    sender: 'ATTACKER-ACCOUNT',
    signer: 'ATTACKER-ACCOUNT',
    receiver: 'ATTACKER-ACCOUNT',
  });

  const evidence = await inspectAnchorReceipt(
    receiptFromMaterial(material),
    adapter,
    expectedClaim(),
  );

  assert.equal(evidence.noteIntegrity, true);
  assert.equal(evidence.transactionIntegrity, false);
  assert.equal(evidence.verified, false);
});

test('keeps verifyAnchor boolean when the Algorand lookup fails', async () => {
  const material = buildNote(
    0x09,
    'org-1',
    'immunization:record-1:fingerprint',
  );
  const receipt = receiptFromMaterial(material);
  const adapter = adapterWithNote(material.note);
  adapter.getTransaction = async () => {
    throw new Error('network unavailable');
  };
  const service = new BlockchainAnchorService(adapter, {
    findByAnchorId: async () => receipt,
    save: async () => receipt,
  });

  const verified = await service.verifyAnchor(
    0x09,
    receipt.anchorId,
    receipt.tenantId,
    receipt,
  );

  assert.equal(verified, false);
});
