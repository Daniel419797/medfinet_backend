const config = require('../../config');
const { DomainError } = require('../../utils/domainError');

const NETWORKS = Object.freeze({
  testnet: Object.freeze({
    id: 'testnet',
    label: 'Algorand TestNet',
    chainId: 416002,
    defaultAlgodServer: 'https://testnet-api.algonode.cloud',
    defaultExplorerTransactionUrl: 'https://testnet.explorer.perawallet.app/tx',
  }),
  mainnet: Object.freeze({
    id: 'mainnet',
    label: 'Algorand MainNet',
    chainId: 416001,
    defaultAlgodServer: 'https://mainnet-api.algonode.cloud',
    defaultExplorerTransactionUrl: 'https://explorer.perawallet.app/tx',
  }),
});

function normalizeNetwork(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'testnet' || normalized === 'test') return 'testnet';
  if (normalized === 'mainnet' || normalized === 'main') return 'mainnet';
  return null;
}

function inferredDefaultNetwork() {
  const configured = normalizeNetwork(process.env.ALGORAND_DEFAULT_NETWORK);
  if (configured) return configured;
  const legacyServer = String(config.algorand.algodServer || '').toLowerCase();
  return legacyServer.includes('mainnet') ? 'mainnet' : 'testnet';
}

function configuredNetworks() {
  const raw = process.env.ALGORAND_ALLOWED_NETWORKS?.trim() || 'testnet,mainnet';
  const values = [...new Set(raw.split(',').map(normalizeNetwork).filter(Boolean))];
  if (!values.length) {
    throw new Error('ALGORAND_ALLOWED_NETWORKS must include testnet or mainnet');
  }
  return values;
}

function defaultNetwork() {
  const preferred = inferredDefaultNetwork();
  const allowed = configuredNetworks();
  return allowed.includes(preferred) ? preferred : allowed[0];
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

function networkEnvironmentValue(network, suffix) {
  const prefix = `ALGORAND_${network.toUpperCase()}_${suffix}`;
  return process.env[prefix]?.trim() || null;
}

function getNetworkConfig(value) {
  const network = resolveNetwork(value);
  const definition = NETWORKS[network];
  const useLegacyDefaults = network === defaultNetwork();
  const algodServer = networkEnvironmentValue(network, 'ALGOD_SERVER')
    || (useLegacyDefaults ? config.algorand.algodServer : null)
    || definition.defaultAlgodServer;
  const algodPort = Number(
    networkEnvironmentValue(network, 'ALGOD_PORT')
      || (useLegacyDefaults ? config.algorand.algodPort : null)
      || 443
  );
  if (!Number.isInteger(algodPort) || algodPort < 1 || algodPort > 65535) {
    throw new Error(`ALGORAND_${network.toUpperCase()}_ALGOD_PORT must be a valid port`);
  }
  const explorerTransactionUrl = (
    networkEnvironmentValue(network, 'EXPLORER_TRANSACTION_URL')
      || (useLegacyDefaults ? config.algorand.explorerTransactionUrl : null)
      || definition.defaultExplorerTransactionUrl
  ).replace(/\/$/, '');

  return Object.freeze({
    enabled: true,
    network,
    networkName: definition.label,
    chainId: definition.chainId,
    algodServer,
    algodPort,
    algodToken: networkEnvironmentValue(network, 'ALGOD_TOKEN')
      || (useLegacyDefaults ? config.algorand.algodToken : '')
      || '',
    explorerTransactionUrl,
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
