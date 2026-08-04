const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createIntegrationHttpClient,
  parseBasicCredential,
  safePath,
  responseJson,
  MAX_RESPONSE_BYTES,
} = require('../services/integrationHttpClient');

function jsonResponse(payload, status = 200) {
  const buffer = Buffer.from(JSON.stringify(payload));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name === 'content-length' ? String(buffer.length) : null;
      },
    },
    async arrayBuffer() {
      return buffer;
    },
  };
}

test('uses managed credentials and never accepts an absolute partner path', async () => {
  let request;
  const client = createIntegrationHttpClient({
    allowedHosts: ['fhir.example.com'],
    resolveCredential(name) {
      assert.equal(name, 'FHIR_TOKEN');
      return 'managed-secret-token';
    },
    async fetchImpl(url, options) {
      request = { url: String(url), options };
      return jsonResponse({ resourceType: 'CapabilityStatement' });
    },
  });
  const result = await client.request(
    {
      baseUrl: 'https://fhir.example.com/r4',
      credentialSecretName: 'FHIR_TOKEN',
      authType: 'BEARER',
      timeoutMs: 5000,
    },
    '/metadata'
  );

  assert.equal(request.url, 'https://fhir.example.com/r4/metadata');
  assert.equal(request.options.headers.authorization, 'Bearer managed-secret-token');
  assert.equal(result.payload.resourceType, 'CapabilityStatement');
  assert.throws(() => safePath('https://attacker.example/path'), /path is invalid/);
  assert.throws(() => safePath('/../metadata'), /path is invalid/);
});

test('encodes basic credentials only in the outbound authorization header', () => {
  const authorization = parseBasicCredential(JSON.stringify({
    username: 'partner',
    password: 'secret',
  }));
  assert.equal(authorization.startsWith('Basic '), true);
  assert.equal(
    Buffer.from(authorization.slice(6), 'base64').toString(),
    'partner:secret'
  );
});

test('rejects oversized partner responses before JSON parsing', async () => {
  await assert.rejects(
    responseJson({
      headers: {
        get() {
          return String(MAX_RESPONSE_BYTES + 1);
        },
      },
    }),
    (error) => error.code === 'INTEGRATION_RESPONSE_TOO_LARGE'
  );
});
