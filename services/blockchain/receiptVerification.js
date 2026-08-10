const crypto = require('node:crypto');
const { noteFromHash, verifyHash } = require('./eventTypes');

function receiptValue(receipt, currentName, databaseName) {
  return receipt[currentName] ?? receipt[databaseName];
}

function addressString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value.addr) return addressString(value.addr);
  return value.toString();
}

function positiveRound(value) {
  if (value === undefined || value === null) return false;
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function emptyInspection(receipt, adapter, overrides = {}) {
  const txId = receipt?.txId || null;
  return {
    receiptIntegrity: false,
    hashIntegrity: false,
    txIdIntegrity: false,
    noteIntegrity: false,
    transactionIntegrity: false,
    chainConfirmed: false,
    verified: false,
    network: adapter.networkName,
    networkId: adapter.networkId,
    explorerUrl: txId ? adapter.getExplorerUrl(txId) : null,
    ...overrides,
  };
}

async function inspectAnchorReceipt(receipt, adapter, expected) {
  if (!receipt || !expected) return emptyInspection(receipt, adapter);
  const eventCode = receipt.eventCode;
  const anchorId = receipt.anchorId;
  const tenantId = receiptValue(receipt, 'tenantId', 'tenantId');
  const timestamp = receiptValue(receipt, 'timestamp', 'isoTimestamp');
  const nonce = receipt.nonce;
  const hash = receiptValue(receipt, 'hash', 'hashHex');
  const txId = receipt.txId;
  const receiptIntegrity = Boolean(
    txId
    && anchorId === expected.anchorId
    && eventCode === expected.eventCode
    && tenantId === expected.tenantId
  );
  if (!receiptIntegrity) return emptyInspection(receipt, adapter);
  const hashIntegrity = verifyHash(eventCode, tenantId, anchorId, timestamp, nonce, hash);
  if (!hashIntegrity) {
    return emptyInspection(receipt, adapter, { receiptIntegrity });
  }
  let expectedNote;
  try {
    expectedNote = noteFromHash(eventCode, hash);
  } catch {
    return {
      receiptIntegrity,
      hashIntegrity,
      txIdIntegrity: false,
      noteIntegrity: false,
      transactionIntegrity: false,
      chainConfirmed: false,
      verified: false,
      network: adapter.networkName,
      networkId: adapter.networkId,
      explorerUrl: adapter.getExplorerUrl(txId),
    };
  }
  const transaction = await adapter.getTransaction(txId);
  const actualNote = transaction?.note ? Buffer.from(transaction.note) : null;
  const txIdIntegrity = transaction?.txId === txId;
  const noteIntegrity = Boolean(
    actualNote
    && actualNote.length === expectedNote.length
    && crypto.timingSafeEqual(actualNote, expectedNote)
  );
  const platformAddress = addressString(adapter.platformAccount);
  let zeroAmount = false;
  try {
    zeroAmount = transaction?.amount !== null
      && transaction?.amount !== undefined
      && BigInt(transaction.amount) === 0n;
  } catch {
    zeroAmount = false;
  }
  const transactionIntegrity = Boolean(
    platformAddress
    && transaction?.type === 'pay'
    && transaction.sender === platformAddress
    && transaction.signer === platformAddress
    && transaction.receiver === platformAddress
    && zeroAmount
    && !transaction.rekeyTo
    && !transaction.closeRemainderTo
  );
  const chainConfirmed = transaction?.confirmed === true
    && positiveRound(transaction.confirmedRound);
  return {
    receiptIntegrity,
    hashIntegrity,
    txIdIntegrity,
    noteIntegrity,
    transactionIntegrity,
    chainConfirmed,
    verified: receiptIntegrity
      && hashIntegrity
      && txIdIntegrity
      && noteIntegrity
      && transactionIntegrity
      && chainConfirmed,
    network: adapter.networkName,
    networkId: adapter.networkId,
    explorerUrl: adapter.getExplorerUrl(txId),
  };
}

module.exports = { inspectAnchorReceipt };
