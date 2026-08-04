const { DomainError } = require('../utils/domainError');
const { baseUrl } = require('./integrationValidation');

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function parseBasicCredential(secret) {
  let parsed;
  try {
    parsed = JSON.parse(secret);
  } catch {
    throw new DomainError(
      503,
      'INTEGRATION_CREDENTIAL_INVALID',
      'Managed basic credential is invalid'
    );
  }
  if (
    typeof parsed.username !== 'string'
    || !parsed.username
    || typeof parsed.password !== 'string'
    || !parsed.password
  ) {
    throw new DomainError(
      503,
      'INTEGRATION_CREDENTIAL_INVALID',
      'Managed basic credential is invalid'
    );
  }
  return `Basic ${Buffer.from(`${parsed.username}:${parsed.password}`).toString('base64')}`;
}

function safePath(path) {
  if (
    typeof path !== 'string'
    || !path.startsWith('/')
    || path.startsWith('//')
    || path.includes('..')
  ) {
    throw new DomainError(500, 'INTEGRATION_PATH_INVALID', 'Integration path is invalid');
  }
  return path;
}

async function responseJson(response) {
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new DomainError(
      502,
      'INTEGRATION_RESPONSE_TOO_LARGE',
      'Partner response exceeds the supported size'
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_RESPONSE_BYTES) {
    throw new DomainError(
      502,
      'INTEGRATION_RESPONSE_TOO_LARGE',
      'Partner response exceeds the supported size'
    );
  }
  if (buffer.length === 0) return null;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new DomainError(
      502,
      'INTEGRATION_RESPONSE_INVALID',
      'Partner response is not valid JSON'
    );
  }
}

function createIntegrationHttpClient({
  resolveCredential,
  allowedHosts,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const tokenCache = new Map();

  async function oauthAuthorization(connection, secret) {
    let credential;
    try {
      credential = JSON.parse(secret);
    } catch {
      throw new DomainError(
        503,
        'INTEGRATION_CREDENTIAL_INVALID',
        'Managed OAuth credential is invalid'
      );
    }
    if (
      typeof credential.clientId !== 'string'
      || typeof credential.clientSecret !== 'string'
      || typeof credential.tokenUrl !== 'string'
    ) {
      throw new DomainError(
        503,
        'INTEGRATION_CREDENTIAL_INVALID',
        'Managed OAuth credential is invalid'
      );
    }
    const tokenUrl = baseUrl(credential.tokenUrl, { allowedHosts });
    const cached = tokenCache.get(connection.credentialSecretName);
    if (cached && cached.expiresAt > now().getTime() + 30_000) {
      return `Bearer ${cached.token}`;
    }
    let response;
    try {
      response = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: {
          authorization: parseBasicCredential(JSON.stringify({
            username: credential.clientId,
            password: credential.clientSecret,
          })),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(connection.timeoutMs),
      });
    } catch {
      throw new DomainError(
        503,
        'INTEGRATION_TOKEN_UNREACHABLE',
        'Partner token endpoint is unavailable'
      );
    }
    const payload = await responseJson(response);
    if (
      !response.ok
      || typeof payload?.access_token !== 'string'
      || !Number.isFinite(Number(payload.expires_in))
    ) {
      throw new DomainError(
        503,
        'INTEGRATION_TOKEN_REJECTED',
        'Partner token endpoint rejected authentication'
      );
    }
    tokenCache.set(connection.credentialSecretName, {
      token: payload.access_token,
      expiresAt: now().getTime() + Number(payload.expires_in) * 1000,
    });
    return `Bearer ${payload.access_token}`;
  }

  async function authorization(connection) {
    const secret = resolveCredential?.(connection.credentialSecretName);
    if (!secret) {
      throw new DomainError(
        503,
        'INTEGRATION_CREDENTIAL_UNAVAILABLE',
        'Managed integration credential is unavailable'
      );
    }
    if (connection.authType === 'BEARER') return `Bearer ${secret}`;
    if (connection.authType === 'BASIC') return parseBasicCredential(secret);
    if (connection.authType === 'OAUTH2_CLIENT_CREDENTIALS') {
      return oauthAuthorization(connection, secret);
    }
    throw new DomainError(
      500,
      'INTEGRATION_AUTH_TYPE_UNSUPPORTED',
      'Integration authentication type is unsupported'
    );
  }

  async function request(connection, path, options = {}) {
    const root = baseUrl(connection.baseUrl, { allowedHosts });
    const url = new URL(`.${safePath(path)}`, `${root}/`);
    if (url.origin !== new URL(root).origin) {
      throw new DomainError(500, 'INTEGRATION_PATH_INVALID', 'Integration path is invalid');
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: options.method || 'GET',
        headers: {
          accept: 'application/json',
          authorization: await authorization(connection),
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(connection.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        503,
        'INTEGRATION_PARTNER_UNREACHABLE',
        'Partner integration endpoint is unavailable'
      );
    }
    const payload = await responseJson(response);
    if (!response.ok) {
      throw new DomainError(
        response.status >= 500 ? 503 : 409,
        'INTEGRATION_PARTNER_REJECTED',
        `Partner integration returned ${response.status}`,
        { partnerStatus: response.status }
      );
    }
    return { status: response.status, payload, headers: response.headers };
  }

  return { request, authorization };
}

module.exports = {
  createIntegrationHttpClient,
  parseBasicCredential,
  safePath,
  responseJson,
  MAX_RESPONSE_BYTES,
};
