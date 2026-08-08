const config = require('../config');
const AnchorReceiptRepository = require('../services/anchorReceiptRepository');
const {
  getNetworkConfig,
  networkFromRequest,
  listAvailableNetworks,
} = require('../services/blockchain/networkRegistry');

const receiptStore = new AnchorReceiptRepository();

async function getAnchor(req, res, next) {
  try {
    const { anchorId } = req.params;
    const receipt = await receiptStore.findByAnchorId(anchorId);
    if (!receipt) {
      return res.status(404).json({
        success: false,
        code: 'ANCHOR_NOT_FOUND',
        message: 'Anchor not found',
      });
    }
    return res.json({ success: true, data: receipt.toJSON() });
  } catch (error) {
    return next(error);
  }
}

async function listAnchors(req, res, next) {
  try {
    const { eventCode, limit, cursor } = req.query;
    const rows = await receiptStore.listByTenant(req.organization.id, {
      limit: Math.min(parseInt(limit, 10) || 50, 100),
      cursor,
      eventCode: eventCode ? parseInt(eventCode, 10) : undefined,
    });
    return res.json({ success: true, data: rows.map((receipt) => receipt.toJSON()) });
  } catch (error) {
    return next(error);
  }
}

async function verifyAnchor(req, res, next) {
  try {
    const { anchorId } = req.params;
    const receipt = await receiptStore.findByAnchorId(anchorId);
    if (!receipt) {
      return res.status(404).json({
        success: false,
        code: 'ANCHOR_NOT_FOUND',
        message: 'Anchor not found',
      });
    }
    const { verifyHash } = require('../services/blockchain/eventTypes');
    const hashOk = verifyHash(
      receipt.eventCode,
      receipt.tenantId,
      receipt.anchorId,
      receipt.timestamp,
      receipt.nonce,
      receipt.hash
    );
    return res.json({
      success: true,
      data: {
        anchorId: receipt.anchorId,
        eventCode: receipt.eventCode,
        eventCategory: receipt.eventCategory,
        txId: receipt.txId,
        blockHeight: receipt.blockHeight,
        confirmedAt: receipt.confirmedAt,
        hashIntegrity: hashOk,
        status: receipt.status,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getBlockchainHealth(req, res, next) {
  try {
    if (!config.algorand.enabled) {
      return res.json({
        success: true,
        data: {
          enabled: false,
          status: 'disabled',
          selectedNetwork: null,
          availableNetworks: [],
          network: null,
          reachable: false,
          walletConnect: {
            enabled: false,
            provider: 'pera',
            chainId: null,
          },
          features: {
            anchors: false,
            donations: false,
            escrow: false,
          },
        },
      });
    }

    const selectedNetwork = networkFromRequest(req);
    const selectedConfig = getNetworkConfig(selectedNetwork);
    const AlgorandAdapter = require('../services/blockchain/adapters/AlgorandAdapter');
    const BlockchainAnchorService = require('../services/blockchain/BlockchainAnchorService');
    const adapter = new AlgorandAdapter(selectedConfig);
    const anchorService = new BlockchainAnchorService(adapter, receiptStore, {
      enabled: true,
      fee: selectedConfig.fee,
    });
    const reachable = await anchorService.isReachable();
    const balance = reachable ? await anchorService.getWalletBalance() : null;

    return res.json({
      success: true,
      data: {
        enabled: true,
        status: reachable ? 'available' : 'unreachable',
        selectedNetwork,
        availableNetworks: listAvailableNetworks(),
        network: adapter.networkName,
        reachable,
        address: adapter.platformAccount.addr.toString(),
        balanceMicroAlgos: balance,
        explorerTransactionUrl: selectedConfig.explorerTransactionUrl,
        walletConnect: {
          enabled: true,
          provider: 'pera',
          chainId: selectedConfig.chainId,
        },
        features: {
          anchors: true,
          donations: true,
          escrow: true,
        },
        circuitBreaker: anchorService.circuitBreaker.toJSON(),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getAnchor,
  listAnchors,
  verifyAnchor,
  getBlockchainHealth,
};
