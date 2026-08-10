const config = require('../config');
const { logger } = require('../utils/logger');
const AnchorReceiptRepository = require('../services/anchorReceiptRepository');
const { inspectAnchorReceipt } = require('../services/blockchain/receiptVerification');
const { eventCodeForAnchorId } = require('../services/blockchain/eventTypes');
const {
  defaultNetwork,
  getNetworkConfig,
  networkFromRequest,
  listAvailableNetworks,
} = require('../services/blockchain/networkRegistry');

const receiptStore = new AnchorReceiptRepository();

async function getAnchor(req, res, next) {
  try {
    const { anchorId } = req.params;
    const receipt = await receiptStore.findByAnchorIdForTenant(
      anchorId,
      req.organization.id
    );
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
    const receipt = await receiptStore.findByAnchorIdForTenant(
      anchorId,
      req.organization.id
    );
    if (!receipt) {
      return res.status(404).json({
        success: false,
        code: 'ANCHOR_NOT_FOUND',
        message: 'Anchor not found',
      });
    }
    const base = {
      anchorId: receipt.anchorId,
      eventCode: receipt.eventCode,
      eventCategory: receipt.eventCategory,
      txId: receipt.txId,
      blockHeight: receipt.blockHeight == null ? null : String(receipt.blockHeight),
      confirmedAt: receipt.confirmedAt,
      receiptIntegrity: null,
      hashIntegrity: null,
      txIdIntegrity: null,
      noteIntegrity: null,
      transactionIntegrity: null,
      chainConfirmed: null,
      network: null,
      networkId: null,
      explorerUrl: null,
    };
    if (!config.algorand.enabled) {
      return res.json({ success: true, data: { ...base, status: 'DISABLED' } });
    }

    const selectedNetwork = networkFromRequest(req);
    const selectedConfig = getNetworkConfig(selectedNetwork);
    const AlgorandAdapter = require('../services/blockchain/adapters/AlgorandAdapter');
    try {
      const inspected = await inspectAnchorReceipt(
        receipt,
        new AlgorandAdapter(selectedConfig),
        {
          anchorId,
          eventCode: eventCodeForAnchorId(anchorId),
          tenantId: req.organization.id,
        }
      );
      const integrityVerified = inspected.receiptIntegrity
        && inspected.hashIntegrity
        && inspected.txIdIntegrity
        && inspected.noteIntegrity
        && inspected.transactionIntegrity;
      const verified = Boolean(integrityVerified && inspected.chainConfirmed);
      const status = verified
        ? 'CONFIRMED'
        : integrityVerified
          ? 'UNCONFIRMED'
          : 'MISMATCH';
      return res.json({
        success: true,
        data: { ...base, ...inspected, verified, status },
      });
    } catch (error) {
      logger.warn('blockchain.anchor-verification-unavailable', {
        anchorId,
        errorType: error?.name || 'Error',
        errorCode: error?.code || null,
      });
      return res.json({ success: true, data: { ...base, status: 'UNAVAILABLE' } });
    }
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

    let selectedNetwork;
    try {
      selectedNetwork = networkFromRequest(req);
    } catch (error) {
      if (error.code !== 'ALGORAND_NETWORK_NOT_ALLOWED') throw error;
      selectedNetwork = defaultNetwork();
    }

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
