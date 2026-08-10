const { buildNote, EVENT_BY_CODE } = require('./eventTypes');
const AnchorReceipt = require('./AnchorReceipt');
const AnchorCircuitBreaker = require('./AnchorCircuitBreaker');
const { inspectAnchorReceipt } = require('./receiptVerification');

class BlockchainAnchorService {
  constructor(adapter, receiptStore, options = {}) {
    if (!adapter) throw new Error('ChainAdapter is required');
    if (!receiptStore) throw new Error('AnchorReceiptRepository is required');
    this._adapter = adapter;
    this._receipts = receiptStore;
    this._circuitBreaker = new AnchorCircuitBreaker(options.circuitBreaker);
    this._fee = options.fee || adapter.defaultFee;
    this._enabled = options.enabled !== false;
  }

  get enabled() {
    return this._enabled;
  }

  get adapter() {
    return this._adapter;
  }

  get circuitBreaker() {
    return this._circuitBreaker;
  }

  async anchorEvent(eventCode, anchorId, tenantId) {
    if (!this._enabled) return null;
    const eventType = EVENT_BY_CODE[eventCode];
    if (!eventType) throw new Error(`Unknown event code: ${eventCode}`);

    const { note, timestamp, nonce, hash } = buildNote(eventCode, tenantId, anchorId);

    let result;
    try {
      result = await this._circuitBreaker.execute(() =>
        this._adapter.submitTransaction(note, this._fee)
      );
    } catch (err) {
      throw new Error(`Anchor failed for ${anchorId}: ${err.message}`);
    }

    const receipt = AnchorReceipt.fromAnchorResult(
      anchorId, eventCode, eventType.category, tenantId,
      { ...result, timestamp, nonce, hash }
    );

    await this._receipts.save(receipt);
    return receipt;
  }

  async verifyAnchor(eventCode, anchorId, tenantId, receipt) {
    if (!this._enabled) return false;
    if (!receipt) return false;
    if (
      receipt.eventCode !== eventCode
      || receipt.anchorId !== anchorId
      || receipt.tenantId !== tenantId
    ) return false;
    try {
      return (await inspectAnchorReceipt(receipt, this._adapter, {
        eventCode,
        anchorId,
        tenantId,
      })).verified;
    } catch {
      return false;
    }
  }

  async getReceipt(anchorId) {
    return this._receipts.findByAnchorId(anchorId);
  }

  async getWalletBalance() {
    if (!this._enabled) return null;
    return this._adapter.getBalance(this._adapter.platformAccount.addr);
  }

  async isReachable() {
    if (!this._enabled) return true;
    return this._adapter.isReachable();
  }

  getExplorerUrl(txId) {
    if (!this._enabled) return null;
    return this._adapter.getExplorerUrl(txId);
  }
}

module.exports = BlockchainAnchorService;
