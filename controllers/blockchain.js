const config = require('../config');
const { logger } = require('../utils/logger');
const { DomainError } = require('../utils/domainError');
const AnchorReceiptRepository = require('../services/anchorReceiptRepository');
const { inspectAnchorReceipt } = require('../services/blockchain/receiptVerification');
const { eventCodeForAnchorId } = require('../services/blockchain/eventTypes');
const {
  defaultNetwork,
  getNetworkConfig,
  networkFromRequest,
  requestedNetworkFromRequest,
  resolveNetwork,
  listAvailableNetworks,
} = require('../services/blockchain/networkRegistry');

const receiptStore = new AnchorReceiptRepository();
const adapterCache = new Map();

function adapterForNetwork(network) {
  if (!adapterCache.has(network)) {
    const AlgorandAdapter = require('../services/blockchain/adapters/AlgorandAdapter');
    adapterCache.set(network, new AlgorandAdapter(getNetworkConfig(network)));
  }
  return adapterCache.get(network);
}

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
      networkIntegrity: null,
      hashIntegrity: null,
      txIdIntegrity: null,
      noteIntegrity: null,
      transactionIntegrity: null,
      transactionLocated: null,
      chainConfirmed: null,
      network: receipt.network || null,
      networkId: receipt.network || null,
      explorerUrl: null,
      reason: null,
    };
    if (!config.algorand.enabled) {
      return res.json({ success: true, data: { ...base, status: 'DISABLED' } });
    }

    if (!receipt.network) {
      return res.json({
        success: true,
        data: { ...base, status: 'UNAVAILABLE', reason: 'ANCHOR_NETWORK_UNKNOWN' },
      });
    }

    let selectedNetwork;
    try {
      selectedNetwork = resolveNetwork(receipt.network);
    } catch (error) {
      logger.warn('blockchain.anchor-network-unavailable', {
        anchorId,
        storedNetwork: receipt.network,
      });
      return res.json({
        success: true,
        data: { ...base, status: 'UNAVAILABLE', reason: 'ANCHOR_NETWORK_UNAVAILABLE' },
      });
    }
    const requestedNetwork = requestedNetworkFromRequest(req);
    if (requestedNetwork && resolveNetwork(requestedNetwork) !== selectedNetwork) {
      throw new DomainError(
        409,
        'ALGORAND_ANCHOR_NETWORK_MISMATCH',
        `Anchor ${anchorId} was submitted to ${selectedNetwork}`,
      );
    }
    const expectedEventCode = eventCodeForAnchorId(anchorId);
    if (!expectedEventCode) {
      return res.json({
        success: true,
        data: { ...base, status: 'UNAVAILABLE', reason: 'ANCHOR_FORMAT_UNSUPPORTED' },
      });
    }
    try {
      const inspected = await inspectAnchorReceipt(
        receipt,
        adapterForNetwork(selectedNetwork),
        {
          anchorId,
          eventCode: expectedEventCode,
          tenantId: req.organization.id,
          network: selectedNetwork,
        }
      );
      return res.json({
        success: true,
        data: { ...base, ...inspected },
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
