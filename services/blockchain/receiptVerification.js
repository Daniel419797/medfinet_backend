const crypto = require('node:crypto');
const { noteFromHash, verifyHash } = require('./eventTypes');

function receiptValue(receipt, currentName, databaseName) {
  return receipt[currentName] ?? receipt[databaseName];
}

async function inspectAnchorReceipt(receipt, adapter) {
  const eventCode = receipt.eventCode;
  const anchorId = receipt.anchorId;
  const tenantId = receiptValue(receipt, 'tenantId', 'tenantId');
  const timestamp = receiptValue(receipt, 'timestamp', 'isoTimestamp');
  const nonce = receipt.nonce;
  const hash = receiptValue(receipt, 'hash', 'hashHex');
  const txId = receipt.txId;
  const hashIntegrity = verifyHash(
    eventCode,
    tenantId,
    anchorId,
    timestamp,
    nonce,
    hash,
  );
  let expectedNote;
  try {
    expectedNote = noteFromHash(eventCode, hash);
  } catch {
    return {
      hashIntegrity,
      noteIntegrity: false,
      chainConfirmed: false,
      verified: false,
      network: adapter.networkName,
      networkId: adapter.networkId,
      explorerUrl: adapter.getExplorerUrl(txId),
    };
  }
  const transaction = await adapter.getTransaction(txId);
  const actualNote = transaction?.note ? Buffer.from(transaction.note) : null;
  const noteIntegrity = Boolean(
    actualNote
    && actualNote.length === expectedNote.length
    && crypto.timingSafeEqual(actualNote, expectedNote)
  );
  const chainConfirmed = transaction?.confirmed === true;
  return {
    hashIntegrity,
    noteIntegrity,
    chainConfirmed,
    verified: hashIntegrity && noteIntegrity && chainConfirmed,
    network: adapter.networkName,
    networkId: adapter.networkId,
    explorerUrl: adapter.getExplorerUrl(txId),
  };
}

module.exports = { inspectAnchorReceipt };
