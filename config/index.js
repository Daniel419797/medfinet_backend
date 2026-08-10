const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const environmentPath = path.resolve(process.env.DOTENV_CONFIG_PATH || '.env');
if (fs.existsSync(environmentPath)) process.loadEnvFile(environmentPath);

function requireString(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  if (value.includes('replace-with-') || value.includes('replace-me') || value.includes('your-project')) {
    throw new Error(`${name} still contains a placeholder value`);
  }
  return value;
}

function requireInteger(name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const rawValue = requireString(name);
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function requireUrl(name) {
  const value = requireString(name);
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
}

function requireCsv(name) {
  const values = requireString(name).split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must contain at least one value`);
  return values;
}

function optionalBoolean(name, defaultValue = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function optionalString(name) {
  return process.env[name]?.trim() || null;
}

function optionalInteger(name, defaultValue, options) {
  if (!process.env[name]?.trim()) return defaultValue;
  return requireInteger(name, options);
}

function optionalUrl(name, defaultValue) {
  const value = optionalString(name) || defaultValue;
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
}

function credentialResolver() {
  const raw = process.env.INTEGRATION_CREDENTIALS_JSON?.trim() || '{}';
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('INTEGRATION_CREDENTIALS_JSON must be a valid JSON object');
  }
  if (
    !credentials
    || Array.isArray(credentials)
    || typeof credentials !== 'object'
    || Object.entries(credentials).some(([name, value]) => (
      !/^[A-Z][A-Z0-9_]{2,99}$/.test(name)
      || typeof value !== 'string'
      || value.length < 1
    ))
  ) {
    throw new Error(
      'INTEGRATION_CREDENTIALS_JSON must map uppercase secret names to non-empty strings'
    );
  }
  return (name) => credentials[name] || null;
}

function integrationPayloadKey(nodeEnv) {
  const raw = process.env.INTEGRATION_PAYLOAD_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (nodeEnv === 'production') {
      throw new Error(
        'Missing required environment variable: INTEGRATION_PAYLOAD_ENCRYPTION_KEY'
      );
    }
    return () => null;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')) {
    throw new Error(
      'INTEGRATION_PAYLOAD_ENCRYPTION_KEY must be a base64-encoded 32-byte key'
    );
  }
  return () => Buffer.from(key);
}

function nfcConfig(nodeEnv) {
  const tapBaseUrl = requireUrl('NFC_TAP_BASE_URL');
  if (nodeEnv === 'production' && new URL(tapBaseUrl).protocol !== 'https:') {
    throw new Error('NFC_TAP_BASE_URL must use HTTPS in production');
  }
  const uidPepper = requireString('NFC_UID_PEPPER');
  if (uidPepper.length < 32) {
    throw new Error('NFC_UID_PEPPER must contain at least 32 characters');
  }
  const provisioningSecret = requireString('NFC_PROVISIONING_SECRET');
  if (provisioningSecret.length < 32) {
    throw new Error('NFC_PROVISIONING_SECRET must contain at least 32 characters');
  }
  const requireOriginalityAttestation = optionalBoolean(
    'NFC_REQUIRE_ORIGINALITY_ATTESTATION',
    nodeEnv === 'production'
  );
  if (nodeEnv === 'production' && !requireOriginalityAttestation) {
    throw new Error(
      'NFC_REQUIRE_ORIGINALITY_ATTESTATION must be true in production'
    );
  }
  return Object.freeze({
    tapBaseUrl,
    uidPepper,
    provisioningSecret,
    hardwareFamily: 'NTAG_215',
    requireOriginalityAttestation,
  });
}

function ussdConfig(nodeEnv) {
  const provider = optionalString('USSD_PROVIDER') || 'africas_talking';
  if (!['africas_talking'].includes(provider)) {
    throw new Error('USSD_PROVIDER must be africas_talking');
  }
  const webhookSecret = optionalString('USSD_WEBHOOK_SECRET');
  const phonePepper = optionalString('USSD_PHONE_PEPPER');
  const pinPepper = optionalString('USSD_PIN_PEPPER');
  const otpPepper = optionalString('USSD_OTP_PEPPER');
  const stateKeyRaw = optionalString('USSD_STATE_ENCRYPTION_KEY');
  const providerCallbackToken = optionalString('USSD_PROVIDER_CALLBACK_TOKEN');
  const backendWebhookUrl = optionalString('USSD_BACKEND_WEBHOOK_URL');
  const secrets = { webhookSecret, phonePepper, pinPepper, otpPepper };
  for (const [name, value] of Object.entries(secrets)) {
    if (value && value.length < 32) {
      throw new Error(`USSD_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()} must contain at least 32 characters`);
    }
  }
  if (nodeEnv === 'production' && Object.values(secrets).some((value) => !value)) {
    throw new Error('All USSD security secrets are required in production');
  }
  if (nodeEnv === 'production' && !stateKeyRaw) {
    throw new Error('USSD_STATE_ENCRYPTION_KEY is required in production');
  }
  if (providerCallbackToken && providerCallbackToken.length < 32) {
    throw new Error('USSD_PROVIDER_CALLBACK_TOKEN must contain at least 32 characters');
  }
  if (nodeEnv === 'production' && !providerCallbackToken) {
    throw new Error('USSD_PROVIDER_CALLBACK_TOKEN is required in production');
  }
  let parsedBackendWebhookUrl = null;
  if (backendWebhookUrl) {
    parsedBackendWebhookUrl = new URL(backendWebhookUrl);
    if (nodeEnv === 'production' && parsedBackendWebhookUrl.protocol !== 'https:') {
      throw new Error('USSD_BACKEND_WEBHOOK_URL must use HTTPS in production');
    }
  } else if (nodeEnv === 'production') {
    throw new Error('USSD_BACKEND_WEBHOOK_URL is required in production');
  }
  let stateKey = null;
  if (stateKeyRaw) {
    stateKey = Buffer.from(stateKeyRaw, 'base64');
    if (
      stateKey.length !== 32
      || stateKey.toString('base64').replace(/=+$/, '') !== stateKeyRaw.replace(/=+$/, '')
    ) {
      throw new Error('USSD_STATE_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
  } else if (otpPepper) {
    stateKey = crypto.createHash('sha256').update(`ussd-state:${otpPepper}`).digest();
  }
  return Object.freeze({
    provider,
    webhookSecret,
    phonePepper,
    pinPepper,
    otpPepper,
    stateEncryptionKey: () => (stateKey ? Buffer.from(stateKey) : null),
    providerCallbackToken,
    backendWebhookUrl: parsedBackendWebhookUrl?.toString() || null,
    ingressPort: optionalInteger('USSD_INGRESS_PORT', 3002, { min: 1, max: 65535 }),
    sessionTtlSeconds: optionalInteger(
      'USSD_SESSION_TTL_SECONDS',
      180,
      { min: 60, max: 600 }
    ),
    otpTtlSeconds: optionalInteger(
      'USSD_OTP_TTL_SECONDS',
      300,
      { min: 120, max: 600 }
    ),
    maxResponseCharacters: optionalInteger(
      'USSD_MAX_RESPONSE_CHARACTERS',
      160,
      { min: 80, max: 182 }
    ),
  });
}

function algorandConfig(nodeEnv) {
  const enabled = optionalBoolean('ALGORAND_ENABLED');
  const definitions = Object.freeze({
    testnet: Object.freeze({
      id: 'testnet',
      label: 'Algorand TestNet',
      chainId: 416002,
      algodServer: 'https://testnet-api.algonode.cloud',
      explorerTransactionUrl: 'https://testnet.explorer.perawallet.app/tx',
    }),
    mainnet: Object.freeze({
      id: 'mainnet',
      label: 'Algorand MainNet',
      chainId: 416001,
      algodServer: 'https://mainnet-api.algonode.cloud',
      explorerTransactionUrl: 'https://explorer.perawallet.app/tx',
    }),
  });
  const normalizeNetwork = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'testnet' || normalized === 'test') return 'testnet';
    if (normalized === 'mainnet' || normalized === 'main') return 'mainnet';
    return null;
  };
  const legacyServer = optionalString('ALGORAND_ALGOD_SERVER');
  const requestedDefault = optionalString('ALGORAND_DEFAULT_NETWORK');
  const defaultNetwork = requestedDefault
    ? normalizeNetwork(requestedDefault)
    : (String(legacyServer || '').toLowerCase().includes('mainnet') ? 'mainnet' : 'testnet');
  if (!defaultNetwork) {
    throw new Error('ALGORAND_DEFAULT_NETWORK must be testnet or mainnet');
  }
  const allowedRaw = optionalString('ALGORAND_ALLOWED_NETWORKS') || 'testnet,mainnet';
  const requestedNetworks = allowedRaw.split(',').map((value) => value.trim()).filter(Boolean);
  const allowedNetworks = [...new Set(requestedNetworks.map(normalizeNetwork))];
  if (
    allowedNetworks.length === 0
    || allowedNetworks.length !== requestedNetworks.length
  ) {
    throw new Error('ALGORAND_ALLOWED_NETWORKS may contain only testnet and mainnet');
  }
  const selectedDefault = allowedNetworks.includes(defaultNetwork)
    ? defaultNetwork
    : allowedNetworks[0];

  let platformWalletMnemonic = null;
  let confirmationRounds = 4;
  let fee = 1_000;
  if (enabled) {
    platformWalletMnemonic = requireString('ALGORAND_PLATFORM_WALLET_MNEMONIC');
    if (platformWalletMnemonic.split(/\s+/).length !== 25) {
      throw new Error('ALGORAND_PLATFORM_WALLET_MNEMONIC must contain exactly 25 words');
    }
    confirmationRounds = optionalInteger(
      'ALGORAND_CONFIRMATION_ROUNDS',
      4,
      { min: 1, max: 10 }
    );
    fee = optionalInteger(
      'ALGORAND_FEE_MICROALGOS',
      1_000,
      { min: 1_000, max: 100_000 }
    );
  }

  const networks = Object.fromEntries(
    Object.entries(definitions).map(([network, definition]) => {
      const prefix = `ALGORAND_${network.toUpperCase()}`;
      const useLegacy = network === selectedDefault;
      const algodServer = optionalUrl(
        `${prefix}_ALGOD_SERVER`,
        (useLegacy && legacyServer) || definition.algodServer
      );
      const explorerTransactionUrl = optionalUrl(
        `${prefix}_EXPLORER_TRANSACTION_URL`,
        (useLegacy && optionalString('ALGORAND_EXPLORER_TRANSACTION_URL'))
          || definition.explorerTransactionUrl
      );
      if (
        enabled
        && nodeEnv === 'production'
        && (algodServer.startsWith('http://') || explorerTransactionUrl.startsWith('http://'))
      ) {
        throw new Error(`${prefix} service URLs must use HTTPS in production`);
      }
      return [network, Object.freeze({
        ...definition,
        algodServer,
        algodPort: optionalInteger(
          `${prefix}_ALGOD_PORT`,
          useLegacy
            ? optionalInteger('ALGORAND_ALGOD_PORT', 443, { min: 1, max: 65535 })
            : 443,
          { min: 1, max: 65535 }
        ),
        algodToken: optionalString(`${prefix}_ALGOD_TOKEN`)
          || (useLegacy ? optionalString('ALGORAND_ALGOD_TOKEN') : null)
          || '',
        explorerTransactionUrl,
      })];
    })
  );
  const defaultSettings = networks[selectedDefault];

  return Object.freeze({
    enabled,
    defaultNetwork: selectedDefault,
    allowedNetworks: Object.freeze(allowedNetworks),
    networks: Object.freeze(networks),
    platformWalletMnemonic,
    confirmationRounds,
    fee,
    // Preserve the original single-network interface for legacy read-only callers.
    algodServer: defaultSettings.algodServer,
    algodPort: defaultSettings.algodPort,
    algodToken: defaultSettings.algodToken,
    explorerTransactionUrl: defaultSettings.explorerTransactionUrl,
  });
}

const AI_OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const AI_ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

function aiConfig(nodeEnv) {
  const enabled = optionalBoolean('AI_ENABLED', false);
  const apiKey = optionalString('AI_API_KEY');
  if (!enabled || !apiKey) {
    return Object.freeze({ enabled: false, provider: 'disabled', model: null });
  }
  const providerRaw = (optionalString('AI_PROVIDER') || 'auto').toLowerCase();
  if (providerRaw !== 'auto' && !['openai', 'anthropic'].includes(providerRaw)) {
    throw new Error('AI_PROVIDER must be openai, anthropic, or auto');
  }
  const model = requireString('AI_MODEL');
  const provider = providerRaw === 'auto'
    ? (/^claude/i.test(model) ? 'anthropic' : 'openai')
    : providerRaw;
  const baseUrl = optionalString('AI_BASE_URL') || (
    provider === 'anthropic'
      ? AI_ANTHROPIC_DEFAULT_BASE_URL
      : AI_OPENAI_DEFAULT_BASE_URL
  );
  if (baseUrl) {
    try {
      new URL(baseUrl);
    } catch {
      throw new Error('AI_BASE_URL must be a valid absolute URL');
    }
  }
  if (nodeEnv === 'production' && baseUrl.startsWith('http://')) {
    throw new Error('AI_BASE_URL must use HTTPS in production');
  }
  let temperature = 0.2;
  const temperatureRaw = optionalString('AI_TEMPERATURE');
  if (temperatureRaw) {
    temperature = Number(temperatureRaw);
    if (Number.isNaN(temperature) || temperature < 0 || temperature > 2) {
      throw new Error('AI_TEMPERATURE must be a number between 0 and 2');
    }
  }
  return Object.freeze({
    enabled: true,
    provider,
    apiKey,
    model,
    baseUrl,
    timeoutMs: optionalInteger(
      'AI_TIMEOUT_MS',
      20_000,
      { min: 1_000, max: 120_000 }
    ),
    maxTokens: optionalInteger(
      'AI_MAX_TOKENS',
      1024,
      { min: 16, max: 16_384 }
    ),
    temperature,
  });
}

const SMS_PROVIDERS = new Set(['bulksmsnigeria']);
const BULKSMS_GATEWAYS = new Set(['direct-refund', 'direct-corporate', 'otp', 'dual-backup']);
const BULKSMS_PRODUCTION_BASE_URL = 'https://www.bulksmsnigeria.com/api/v2';
const BULKSMS_SANDBOX_BASE_URL = 'https://www.bulksmsnigeria.com/api/sandbox/v2';

function smsConfig(nodeEnv) {
  const providerRaw = optionalString('SMS_PROVIDER');
  if (!providerRaw) return Object.freeze({ provider: null });
  const provider = providerRaw.toLowerCase();
  if (!SMS_PROVIDERS.has(provider)) {
    throw new Error('SMS_PROVIDER must be bulksmsnigeria');
  }
  const apiToken = requireString('BULKSMS_NIGERIA_API_TOKEN');
  const senderId = optionalString('BULKSMS_NIGERIA_SENDER_ID') || 'MEDFINET';
  if (!/^[A-Za-z0-9]{1,11}$/.test(senderId)) {
    throw new Error('BULKSMS_NIGERIA_SENDER_ID must contain 1 to 11 alphanumeric characters');
  }
  const gateway = optionalString('BULKSMS_NIGERIA_GATEWAY') || 'direct-refund';
  if (!BULKSMS_GATEWAYS.has(gateway)) {
    throw new Error('BULKSMS_NIGERIA_GATEWAY must be direct-refund, direct-corporate, otp, or dual-backup');
  }
  const baseUrlRaw = optionalString('BULKSMS_NIGERIA_BASE_URL') || (
    nodeEnv === 'production' ? BULKSMS_PRODUCTION_BASE_URL : BULKSMS_SANDBOX_BASE_URL
  );
  let baseUrl;
  try {
    baseUrl = new URL(baseUrlRaw).toString().replace(/\/$/, '');
  } catch {
    throw new Error('BULKSMS_NIGERIA_BASE_URL must be a valid absolute URL');
  }
  if (nodeEnv === 'production' && baseUrl.startsWith('http://')) {
    throw new Error('BULKSMS_NIGERIA_BASE_URL must use HTTPS in production');
  }
  const callbackUrlRaw = optionalString('BULKSMS_NIGERIA_CALLBACK_URL');
  let callbackUrl = null;
  if (callbackUrlRaw) {
    try {
      callbackUrl = new URL(callbackUrlRaw).toString().replace(/\/$/, '');
    } catch {
      throw new Error('BULKSMS_NIGERIA_CALLBACK_URL must be a valid absolute URL');
    }
  }
  return Object.freeze({
    provider,
    apiToken,
    senderId,
    gateway,
    baseUrl,
    callbackUrl,
    timeoutMs: optionalInteger(
      'BULKSMS_NIGERIA_TIMEOUT_MS',
      10_000,
      { min: 1_000, max: 60_000 }
    ),
  });
}

function loadConfig() {
  const nodeEnv = requireString('NODE_ENV');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const jwtSecret = requireString('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  const configuredDevicePepper = process.env.DEVICE_IDENTIFIER_PEPPER?.trim();
  const configuredRewardTokenSecret = process.env.REWARD_TOKEN_SECRET?.trim();
  const configuredRateLimitPepper = process.env.RATE_LIMIT_KEY_PEPPER?.trim();
  if (configuredDevicePepper && configuredDevicePepper.length < 32) {
    throw new Error('DEVICE_IDENTIFIER_PEPPER must contain at least 32 characters');
  }
  if (nodeEnv === 'production' && !configuredDevicePepper) {
    throw new Error('Missing required environment variable: DEVICE_IDENTIFIER_PEPPER');
  }
  if (configuredRewardTokenSecret && configuredRewardTokenSecret.length < 32) {
    throw new Error('REWARD_TOKEN_SECRET must contain at least 32 characters');
  }
  if (nodeEnv === 'production' && !configuredRewardTokenSecret) {
    throw new Error('Missing required environment variable: REWARD_TOKEN_SECRET');
  }
  if (configuredRateLimitPepper && configuredRateLimitPepper.length < 32) {
    throw new Error('RATE_LIMIT_KEY_PEPPER must contain at least 32 characters');
  }
  if (nodeEnv === 'production' && !configuredRateLimitPepper) {
    throw new Error('Missing required environment variable: RATE_LIMIT_KEY_PEPPER');
  }
  if (nodeEnv === 'production' && !process.env.TRUST_PROXY_HOPS?.trim()) {
    throw new Error('Missing required environment variable: TRUST_PROXY_HOPS');
  }
  const notificationGatewayUrl = optionalString('NOTIFICATION_GATEWAY_URL');
  const notificationGatewayToken = optionalString('NOTIFICATION_GATEWAY_TOKEN');
  const notificationWebhookSecret = optionalString('NOTIFICATION_WEBHOOK_SECRET');
  const notificationValues = [
    notificationGatewayUrl,
    notificationGatewayToken,
    notificationWebhookSecret,
  ];
  if (
    notificationValues.some(Boolean)
    && !notificationValues.every(Boolean)
  ) {
    throw new Error(
      'NOTIFICATION_GATEWAY_URL, NOTIFICATION_GATEWAY_TOKEN, and NOTIFICATION_WEBHOOK_SECRET must be configured together'
    );
  }
  if (notificationWebhookSecret && notificationWebhookSecret.length < 32) {
    throw new Error('NOTIFICATION_WEBHOOK_SECRET must contain at least 32 characters');
  }
  if (nodeEnv === 'production' && !notificationGatewayUrl) {
    throw new Error('Missing required environment variable: NOTIFICATION_GATEWAY_URL');
  }
  if (notificationGatewayUrl) {
    const parsedGatewayUrl = new URL(notificationGatewayUrl);
    if (nodeEnv === 'production' && parsedGatewayUrl.protocol !== 'https:') {
      throw new Error('NOTIFICATION_GATEWAY_URL must use HTTPS in production');
    }
  }
  const resolveIntegrationCredential = credentialResolver();
  const resolveIntegrationPayloadKey = integrationPayloadKey(nodeEnv);
  const integrationAllowedHosts = optionalString('INTEGRATION_ALLOWED_HOSTS')
    ?.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean) || [];
  if (
    integrationAllowedHosts.some((host) => (
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)
    ))
  ) {
    throw new Error('INTEGRATION_ALLOWED_HOSTS contains an invalid hostname');
  }
  if (nodeEnv === 'production' && integrationAllowedHosts.length === 0) {
    throw new Error('Missing required environment variable: INTEGRATION_ALLOWED_HOSTS');
  }
  const allowLegacyJwt = optionalBoolean('AUTH_ALLOW_LEGACY_JWT');
  if (nodeEnv === 'production' && allowLegacyJwt) {
    throw new Error('AUTH_ALLOW_LEGACY_JWT cannot be enabled in production');
  }

  return Object.freeze({
    nodeEnv,
    port: requireInteger('PORT', { min: 1, max: 65535 }),
    databaseUrl: requireUrl('DATABASE_URL'),
    corsOrigins: requireCsv('CORS_ORIGINS'),
    requestBodyLimit: requireString('REQUEST_BODY_LIMIT'),
    jwtSecret,
    jwtExpiresIn: requireString('JWT_EXPIRES_IN'),
    auth: Object.freeze({ allowLegacyJwt }),
    security: Object.freeze({
      deviceIdentifierPepper: configuredDevicePepper || jwtSecret,
      rewardTokenSecret: configuredRewardTokenSecret || jwtSecret,
      rateLimitKeyPepper: configuredRateLimitPepper || jwtSecret,
      trustProxyHops: optionalInteger(
        'TRUST_PROXY_HOPS',
        0,
        { min: 0, max: 10 }
      ),
    }),
    notifications: Object.freeze({
      gatewayUrl: notificationGatewayUrl,
      gatewayToken: notificationGatewayToken,
      webhookSecret: notificationWebhookSecret,
    }),
    sms: smsConfig(nodeEnv),
    integrations: Object.freeze({
      resolveCredential: resolveIntegrationCredential,
      allowedHosts: Object.freeze(integrationAllowedHosts),
      payloadKey: resolveIntegrationPayloadKey,
    }),
    nfc: nfcConfig(nodeEnv),
    ussd: ussdConfig(nodeEnv),
    algorand: algorandConfig(nodeEnv),
    ai: aiConfig(nodeEnv),
    supabase: Object.freeze({
      url: requireUrl('SUPABASE_URL'),
      anonKey: requireString('SUPABASE_ANON_KEY'),
      serviceRoleKey: requireString('SUPABASE_SERVICE_ROLE_KEY'),
    }),
  });
}

module.exports = loadConfig();
