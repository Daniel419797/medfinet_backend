const { NOTE_VERSION, VERSION_BYTES, TYPE_BYTE, HASH_BYTES } = require('./eventTypes');

class AnchorReceipt {
  constructor(fields) {
    this.anchorId = fields.anchorId;
    this.eventCode = fields.eventCode;
    this.eventCategory = fields.eventCategory;
    this.tenantId = fields.tenantId;
    this.txId = fields.txId;
    this.blockHeight = fields.blockHeight;
    this.timestamp = fields.timestamp;
    this.nonce = fields.nonce;
    this.hash = fields.hash;
    this.confirmations = fields.confirmations;
    this.submittedAt = fields.submittedAt || new Date().toISOString();
    this.confirmedAt = fields.confirmedAt || null;
    this.status = fields.status || 'pending';
  }

  get noteLength() {
    return VERSION_BYTES + TYPE_BYTE + HASH_BYTES;
  }

  toJSON() {
    return {
      anchorId: this.anchorId,
      eventCode: this.eventCode,
      eventCategory: this.eventCategory,
      tenantId: this.tenantId,
      txId: this.txId,
      blockHeight: this.blockHeight == null ? null : String(this.blockHeight),
      timestamp: this.timestamp,
      nonce: this.nonce,
      hash: this.hash,
      confirmations: this.confirmations,
      submittedAt: this.submittedAt,
      confirmedAt: this.confirmedAt,
      status: this.status,
    };
  }

  toDatabase() {
    return {
      anchorId: this.anchorId,
      eventCode: this.eventCode,
      eventCategory: this.eventCategory,
      tenantId: this.tenantId,
      txId: this.txId,
      blockHeight: this.blockHeight,
      isoTimestamp: this.timestamp,
      nonce: this.nonce,
      hashHex: this.hash,
      confirmations: this.confirmations,
      submittedAt: this.submittedAt,
      confirmedAt: this.confirmedAt,
      status: this.status,
    };
  }

  static fromDatabase(row) {
    return new AnchorReceipt({
      anchorId: row.anchorId,
      eventCode: row.eventCode,
      eventCategory: row.eventCategory,
      tenantId: row.tenantId,
      txId: row.txId,
      blockHeight: row.blockHeight,
      timestamp: row.isoTimestamp,
      nonce: row.nonce,
      hash: row.hashHex,
      confirmations: row.confirmations,
      submittedAt: row.submittedAt,
      confirmedAt: row.confirmedAt,
      status: row.status,
    });
  }

  static fromAnchorResult(anchorId, eventCode, eventCategory, tenantId, result) {
    return new AnchorReceipt({
      anchorId,
      eventCode,
      eventCategory,
      tenantId,
      txId: result.txId,
      blockHeight: result.blockHeight,
      timestamp: result.timestamp,
      nonce: result.nonce,
      hash: result.hash,
      confirmations: result.confirmations,
      submittedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      status: 'confirmed',
    });
  }
}

module.exports = AnchorReceipt;
