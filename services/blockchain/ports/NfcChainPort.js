const { EVENT_TYPES } = require('../eventTypes');

class NfcChainPort {
  constructor(anchorService) {
    if (!anchorService) throw new Error('BlockchainAnchorService is required');
    this._anchor = anchorService;
  }

  get enabled() {
    return this._anchor.enabled;
  }

  async anchorActivation(bindingId, publicId, childId, tenantId) {
    return this._anchor.anchorEvent(
      EVENT_TYPES.NFC_ACTIVATE.code,
      bindingId,
      tenantId
    );
  }

  async anchorRevocation(bindingId, publicId, tenantId) {
    return this._anchor.anchorEvent(
      EVENT_TYPES.NFC_REVOKE.code,
      bindingId,
      tenantId
    );
  }

  async anchorReplacement(oldBindingId, newBindingId, tenantId) {
    return this._anchor.anchorEvent(
      EVENT_TYPES.NFC_REPLACE.code,
      oldBindingId,
      tenantId
    );
  }

  async verifyIssuance(publicId) {
    if (!this._anchor.enabled) return null;
    const receipt = await this._anchor.getReceipt(publicId);
    if (!receipt) return null;
    const tx = await this._anchor.adapter.getTransaction(receipt.txId);
    return {
      verified: tx !== null && tx.confirmed === true,
      txId: receipt.txId,
      explorerUrl: this._anchor.getExplorerUrl(receipt.txId),
      confirmedAt: receipt.confirmedAt,
    };
  }
}

module.exports = NfcChainPort;