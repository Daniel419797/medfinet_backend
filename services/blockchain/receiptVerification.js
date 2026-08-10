const crypto = require('node:crypto');
const { noteFromHash, verifyHash } = require('./eventTypes');
const { addressString, positiveRound } = require('./algorandValues');

const ALGORAND_ZERO_ADDRESS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

function receiptValue(receipt, currentName, databaseName) {
  return receipt[currentName] ?? receipt[databaseName];
}

function isUnsetAddress(value) {
  const address = addressString(value);
  return !address || address === ALGORAND_ZERO_ADDRESS;
}

function emptyInspection(receipt, adapter, overrides = {}) {
  const txId = receipt?.txId || null;
  return {
    status: 'UNAVAILABLE',
    reason: 'VERIFICATION_CONTEXT_INCOMPLETE',
    receiptIntegrity: false,
    networkIntegrity: false,
    hashIntegrity: false,
    txIdIntegrity: null,
    noteIntegrity: null,
    transactionIntegrity: null,
    transactionLocated: null,
    chainConfirmed: null,
    verified: false,
    network: adapter.networkName,
    networkId: adapter.networkId,
    explorerUrl: txId ? adapter.getExplorerUrl(txId) : null,
    ...overrides,
  };
}

async function inspectAnchorReceipt(receipt, adapter, expected) {
  if (
    !receipt
    || !expected?.anchorId
    || !Number.isInteger(expected.eventCode)
    || !expected.tenantId
  ) {
    return emptyInspection(receipt, adapter);
  }
  const eventCode = receipt.eventCode;
  const anchorId = receipt.anchorId;
  const tenantId = receiptValue(receipt, 'tenantId', 'tenantId');
  const network = receipt.network || null;
  const timestamp = receiptValue(receipt, 'timestamp', 'isoTimestamp');
  const nonce = receipt.nonce;
  const hash = receiptValue(receipt, 'hash', 'hashHex');
  const txId = receipt.txId;
  const networkIntegrity = expected.network
    ? network === expected.network && adapter.networkId === expected.network
    : true;
  const receiptIntegrity = Boolean(
    txId
    && anchorId === expected.anchorId
    && eventCode === expected.eventCode
    && tenantId === expected.tenantId
    && networkIntegrity
  );
  if (!receiptIntegrity) {
    return emptyInspection(receipt, adapter, {
      status: 'MISMATCH',
      reason: 'RECEIPT_CLAIM_MISMATCH',
      networkIntegrity,
    });
  }
  const hashIntegrity = verifyHash(eventCode, tenantId, anchorId, timestamp, nonce, hash);
  if (!hashIntegrity) {
    return emptyInspection(receipt, adapter, {
      status: 'MISMATCH',
      reason: 'RECEIPT_HASH_MISMATCH',
      receiptIntegrity,
      networkIntegrity,
    });
  }
  let expectedNote;
  try {
    expectedNote = noteFromHash(eventCode, hash);
  } catch {
    return {
      status: 'MISMATCH',
      reason: 'RECEIPT_NOTE_INVALID',
      receiptIntegrity,
      networkIntegrity,
      hashIntegrity,
      txIdIntegrity: false,
      noteIntegrity: false,
      transactionIntegrity: false,
      transactionLocated: null,
      chainConfirmed: false,
      verified: false,
      network: adapter.networkName,
      networkId: adapter.networkId,
      explorerUrl: adapter.getExplorerUrl(txId),
    };
  }
  const transaction = await adapter.getTransaction(txId);
  const transactionLocated = Boolean(
    transaction
    && (transaction.lookupStatus === 'FOUND' || transaction.txId)
  );
  if (!transactionLocated) {
    return {
      status: 'UNAVAILABLE',
      reason: transaction?.unavailableReason || 'TRANSACTION_LOOKUP_UNAVAILABLE',
      receiptIntegrity,
      networkIntegrity,
      hashIntegrity,
      txIdIntegrity: null,
      noteIntegrity: null,
      transactionIntegrity: null,
      transactionLocated: false,
      chainConfirmed: null,
      verified: false,
      network: adapter.networkName,
      networkId: adapter.networkId,
      explorerUrl: adapter.getExplorerUrl(txId),
    };
  }
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
    && isUnsetAddress(transaction.rekeyTo)
    && isUnsetAddress(transaction.closeRemainderTo)
  );
  const chainConfirmed = transaction?.confirmed === true
    && positiveRound(transaction.confirmedRound);
  const integrityVerified = receiptIntegrity
    && hashIntegrity
    && txIdIntegrity
    && noteIntegrity
    && transactionIntegrity;
  const status = integrityVerified
    ? (chainConfirmed ? 'CONFIRMED' : 'UNCONFIRMED')
    : 'MISMATCH';
  return {
    status,
    reason: status === 'MISMATCH' ? 'TRANSACTION_INTEGRITY_MISMATCH' : null,
    receiptIntegrity,
    networkIntegrity,
    hashIntegrity,
    txIdIntegrity,
    noteIntegrity,
    transactionIntegrity,
    transactionLocated,
    chainConfirmed,
    verified: status === 'CONFIRMED',
    network: adapter.networkName,
    networkId: adapter.networkId,
    explorerUrl: adapter.getExplorerUrl(txId),
  };
}

module.exports = { inspectAnchorReceipt };
