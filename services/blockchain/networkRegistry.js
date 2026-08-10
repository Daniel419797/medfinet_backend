const config = require('../../config');
const { DomainError } = require('../../utils/domainError');

const NETWORKS = Object.freeze({
  testnet: config.algorand.networks.testnet,
  mainnet: config.algorand.networks.mainnet,
});

function normalizeNetwork(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'testnet' || normalized === 'test') return 'testnet';
  if (normalized === 'mainnet' || normalized === 'main') return 'mainnet';
  return null;
}

function configuredNetworks() {
  return config.algorand.allowedNetworks;
}

function defaultNetwork() {
  return config.algorand.defaultNetwork;
}

function resolveNetwork(value) {
  if (!config.algorand.enabled) {
    throw new DomainError(503, 'ALGORAND_DISABLED', 'Algorand is disabled in this environment');
  }

  const selected = normalizeNetwork(value) || defaultNetwork();
  if (!configuredNetworks().includes(selected)) {
    throw new DomainError(
      400,
      'ALGORAND_NETWORK_NOT_ALLOWED',
      `Algorand network ${selected} is not enabled for this deployment`
    );
  }
  return selected;
}

function getNetworkConfig(value) {
  const network = resolveNetwork(value);
  const definition = NETWORKS[network];

  return Object.freeze({
    enabled: true,
    network,
    networkName: definition.label,
    chainId: definition.chainId,
    algodServer: definition.algodServer,
    algodPort: definition.algodPort,
    algodToken: definition.algodToken,
    explorerTransactionUrl: definition.explorerTransactionUrl,
    platformWalletMnemonic: config.algorand.platformWalletMnemonic,
    confirmationRounds: config.algorand.confirmationRounds,
    fee: config.algorand.fee,
  });
}

function networkFromRequest(req, explicitValue) {
  return resolveNetwork(
    explicitValue
      || req?.get?.('x-algorand-network')
      || req?.query?.network
      || req?.body?.network
  );
}

function listAvailableNetworks() {
  if (!config.algorand.enabled) return [];
  const fallback = defaultNetwork();
  return configuredNetworks().map((network) => {
    const settings = getNetworkConfig(network);
    return {
      id: network,
      label: settings.networkName,
      chainId: settings.chainId,
      isDefault: network === fallback,
      explorerTransactionUrl: settings.explorerTransactionUrl,
    };
  });
}

module.exports = {
  NETWORKS,
  normalizeNetwork,
  defaultNetwork,
  resolveNetwork,
  getNetworkConfig,
  networkFromRequest,
  listAvailableNetworks,
};
