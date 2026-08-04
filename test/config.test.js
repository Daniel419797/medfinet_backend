const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

const validEnvironment = {
  DOTENV_CONFIG_PATH: path.join(projectRoot, 'test', '.env.does-not-exist'),
  NODE_ENV: 'test',
  PORT: '3001',
  CORS_ORIGINS: 'http://localhost:3000,https://app.example.com',
  REQUEST_BODY_LIMIT: '1mb',
  DATABASE_URL: 'postgresql://app-user:test-password@localhost:5432/medfinet_test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  JWT_SECRET: 'a-secure-test-secret-that-is-32-characters-long',
  DEVICE_IDENTIFIER_PEPPER: 'a-separate-device-pepper-that-is-32-characters-long',
  REWARD_TOKEN_SECRET: 'a-separate-reward-token-secret-that-is-32-characters-long',
  RATE_LIMIT_KEY_PEPPER: 'a-separate-rate-limit-pepper-that-is-32-characters-long',
  TRUST_PROXY_HOPS: '1',
  NOTIFICATION_GATEWAY_URL: 'https://notifications.example.com/v1/messages',
  NOTIFICATION_GATEWAY_TOKEN: 'notification-gateway-token',
  NOTIFICATION_WEBHOOK_SECRET: 'notification-webhook-secret-that-is-32-characters',
  USSD_PROVIDER: 'africas_talking',
  USSD_WEBHOOK_SECRET: 'ussd-webhook-secret-that-is-at-least-32-characters',
  USSD_PHONE_PEPPER: 'ussd-phone-pepper-that-is-at-least-32-characters',
  USSD_PIN_PEPPER: 'ussd-pin-pepper-that-is-at-least-32-characters',
  USSD_OTP_PEPPER: 'ussd-otp-pepper-that-is-at-least-32-characters',
  USSD_STATE_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  USSD_PROVIDER_CALLBACK_TOKEN: 'provider-callback-token-that-is-at-least-32-characters',
  USSD_BACKEND_WEBHOOK_URL: 'https://api.example.com/api/v1/webhooks/ussd/africas-talking',
  INTEGRATION_CREDENTIALS_JSON: '{}',
  INTEGRATION_ALLOWED_HOSTS: 'fhir.example.com,dhis2.example.com',
  INTEGRATION_PAYLOAD_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  NFC_TAP_BASE_URL: 'https://id.example.com/nfc/tap',
  NFC_UID_PEPPER: 'a-separate-nfc-uid-pepper-that-is-32-characters-long',
  NFC_PROVISIONING_SECRET: 'a-separate-nfc-provisioning-secret-over-32-characters',
  NFC_REQUIRE_ORIGINALITY_ATTESTATION: 'true',
  JWT_EXPIRES_IN: '24h',
  ALGOD_TOKEN: 'algod-token',
  ALGOD_SERVER: 'https://algod.example.com',
  ALGOD_PORT: '443',
  INDEXER_TOKEN: 'indexer-token',
  INDEXER_SERVER: 'https://indexer.example.com',
  INDEXER_PORT: '443',
  PLATFORM_WALLET_MNEMONIC: 'test-only-mnemonic',
  ALGORAND_EXPLORER_TRANSACTION_URL: 'https://explorer.example.com/tx',
  ALGORAND_VACCINATION_PROOF_URL: 'https://example.com/vaccination-proof/v1',
  ALGORAND_CONFIRMATION_ROUNDS: '4',
  ALGORAND_NETWORK_NAME: 'Test Network',
  PINATA_JWT: 'rotated-pinata-token',
  PINATA_API_URL: 'https://pinata.example.com/upload',
  PINATA_GATEWAY_URL: 'https://gateway.example.com/ipfs',
  NFT_STORAGE_API_TOKEN: 'nft-token',
  WEB3_STORAGE_TOKEN: 'web3-token',
  IPFS_DWEB_GATEWAY_URL_TEMPLATE: 'https://{cid}.example.com/{path}',
  PLATFORM_FEE_PERCENTAGE: '2',
  MIN_DONATION_AMOUNT: '0.1',
  CAMPAIGN_DURATION_DAYS_MAX: '365',
};

function loadConfig(overrides = {}, removedVariables = []) {
  const environment = { ...validEnvironment, ...overrides };
  for (const variable of removedVariables) delete environment[variable];

  return spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./config")))'], {
    cwd: projectRoot,
    env: environment,
    encoding: 'utf8',
  });
}

test('loads validated environment configuration', () => {
  const result = loadConfig();

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout.trim());
  assert.equal(config.port, 3001);
  assert.deepEqual(config.corsOrigins, ['http://localhost:3000', 'https://app.example.com']);
  assert.equal(config.security.trustProxyHops, 1);
});

test('fails closed when JWT_SECRET is missing', () => {
  const result = loadConfig({}, ['JWT_SECRET']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required environment variable: JWT_SECRET/);
});

test('rejects a short JWT secret instead of accepting an unsafe fallback', () => {
  const result = loadConfig({ JWT_SECRET: 'short' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET must contain at least 32 characters/);
});

test('does not allow legacy application JWTs in production', () => {
  const result = loadConfig({
    NODE_ENV: 'production',
    AUTH_ALLOW_LEGACY_JWT: 'true',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUTH_ALLOW_LEGACY_JWT cannot be enabled in production/);
});

test('loads the NTAG215 production security contract', () => {
  const result = loadConfig({
    NODE_ENV: 'production',
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout.trim());
  assert.equal(config.nfc.hardwareFamily, 'NTAG_215');
  assert.equal(config.nfc.requireOriginalityAttestation, true);
});

test('requires independent USSD security secrets in production', () => {
  for (const variable of [
    'USSD_WEBHOOK_SECRET',
    'USSD_PHONE_PEPPER',
    'USSD_PIN_PEPPER',
    'USSD_OTP_PEPPER',
  ]) {
    const result = loadConfig({ NODE_ENV: 'production' }, [variable]);
    assert.notEqual(result.status, 0, `${variable} must be required`);
    assert.match(result.stderr, /All USSD security secrets are required in production/);
  }
});

test('requires an independent USSD state encryption key in production', () => {
  const result = loadConfig({ NODE_ENV: 'production' }, ['USSD_STATE_ENCRYPTION_KEY']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /USSD_STATE_ENCRYPTION_KEY is required in production/);
});

test('requires a protected USSD provider ingress contract in production', () => {
  for (const variable of ['USSD_PROVIDER_CALLBACK_TOKEN', 'USSD_BACKEND_WEBHOOK_URL']) {
    const result = loadConfig({ NODE_ENV: 'production' }, [variable]);
    assert.notEqual(result.status, 0, `${variable} must be required`);
  }
  const insecure = loadConfig({
    NODE_ENV: 'production',
    USSD_BACKEND_WEBHOOK_URL: 'http://api.example.com/ussd',
  });
  assert.notEqual(insecure.status, 0);
  assert.match(insecure.stderr, /USSD_BACKEND_WEBHOOK_URL must use HTTPS/);
});

test('does not allow NTAG215 originality checks to be disabled in production', () => {
  const result = loadConfig({
    NODE_ENV: 'production',
    NFC_REQUIRE_ORIGINALITY_ATTESTATION: 'false',
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /NFC_REQUIRE_ORIGINALITY_ATTESTATION must be true in production/
  );
});

test('requires a separate device identifier pepper in production', () => {
  const result = loadConfig(
    { NODE_ENV: 'production' },
    ['DEVICE_IDENTIFIER_PEPPER']
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Missing required environment variable: DEVICE_IDENTIFIER_PEPPER/
  );
});

test('requires a separate reward token secret in production', () => {
  const result = loadConfig(
    { NODE_ENV: 'production' },
    ['REWARD_TOKEN_SECRET']
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Missing required environment variable: REWARD_TOKEN_SECRET/
  );
});

test('requires a separate rate-limit pepper in production', () => {
  const result = loadConfig(
    { NODE_ENV: 'production' },
    ['RATE_LIMIT_KEY_PEPPER']
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Missing required environment variable: RATE_LIMIT_KEY_PEPPER/
  );
});

test('requires the notification gateway contract in production', () => {
  const result = loadConfig(
    { NODE_ENV: 'production' },
    [
      'NOTIFICATION_GATEWAY_URL',
      'NOTIFICATION_GATEWAY_TOKEN',
      'NOTIFICATION_WEBHOOK_SECRET',
    ]
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Missing required environment variable: NOTIFICATION_GATEWAY_URL/
  );
});

test('loads a configured BulkSMS Nigeria SMS provider', () => {
  const result = loadConfig({
    SMS_PROVIDER: 'bulksmsnigeria',
    BULKSMS_NIGERIA_API_TOKEN: 'bulksms-api-token',
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout.trim());
  assert.equal(config.sms.provider, 'bulksmsnigeria');
  assert.equal(config.sms.apiToken, 'bulksms-api-token');
  assert.equal(config.sms.senderId, 'MEDFINET');
  assert.equal(config.sms.gateway, 'direct-refund');
  assert.match(config.sms.baseUrl, /api\/sandbox\/v2$/);
});

test('requires the BulkSMS Nigeria API token once the provider is enabled', () => {
  const result = loadConfig({ SMS_PROVIDER: 'bulksmsnigeria' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BULKSMS_NIGERIA_API_TOKEN/);
});

test('rejects an invalid BulkSMS Nigeria sender ID and gateway', () => {
  const invalidSender = loadConfig({
    SMS_PROVIDER: 'bulksmsnigeria',
    BULKSMS_NIGERIA_API_TOKEN: 'bulksms-api-token',
    BULKSMS_NIGERIA_SENDER_ID: 'THIS SENDER IS WAY TOO LONG',
  });
  assert.notEqual(invalidSender.status, 0);
  assert.match(invalidSender.stderr, /BULKSMS_NIGERIA_SENDER_ID/);

  const invalidGateway = loadConfig({
    SMS_PROVIDER: 'bulksmsnigeria',
    BULKSMS_NIGERIA_API_TOKEN: 'bulksms-api-token',
    BULKSMS_NIGERIA_GATEWAY: 'not-a-gateway',
  });
  assert.notEqual(invalidGateway.status, 0);
  assert.match(invalidGateway.stderr, /BULKSMS_NIGERIA_GATEWAY/);
});

test('rejects invalid ports and proxy configuration', () => {
  const invalidPort = loadConfig({ PORT: '70000' });
  assert.notEqual(invalidPort.status, 0);
  assert.match(invalidPort.stderr, /PORT must be an integer between 1 and 65535/);

  const invalidProxy = loadConfig({ TRUST_PROXY_HOPS: '100' });
  assert.notEqual(invalidProxy.status, 0);
  assert.match(invalidProxy.stderr, /TRUST_PROXY_HOPS must be an integer/);
});

test('rejects committed example placeholders', () => {
  const result = loadConfig({ JWT_SECRET: 'replace-with-a-secure-secret-value-longer-than-32' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET still contains a placeholder value/);
});
