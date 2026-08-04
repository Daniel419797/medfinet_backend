const assert = require('node:assert/strict');
const test = require('node:test');
const { bearerToken, createAuthMiddleware } = require('../middleware/auth');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function configuration(allowLegacyJwt = false) {
  return {
    auth: { allowLegacyJwt },
    jwtSecret: 'test-secret',
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon-key' },
  };
}

test('extracts only a strict Bearer token', () => {
  assert.equal(bearerToken('Bearer valid-token'), 'valid-token');
  assert.equal(bearerToken('bearer valid-token'), null);
  assert.equal(bearerToken('Bearer token with spaces'), null);
  assert.equal(bearerToken(undefined), null);
});

test('accepts a user verified by the identity provider', async () => {
  const middleware = createAuthMiddleware({
    configuration: configuration(),
    supabaseClient: {
      auth: {
        async getUser(token) {
          assert.equal(token, 'valid-token');
          return { data: { user: { id: 'subject-1' } }, error: null };
        },
      },
    },
    jwtLibrary: {
      decode() {
        return { aal: 'aal2', iat: 1_700_000_000 };
      },
    },
  });
  const req = { headers: { authorization: 'Bearer valid-token' } };
  const res = responseRecorder();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 'subject-1');
  assert.equal(req.authenticationMethod, 'supabase');
  assert.equal(req.authenticationAssurance, 'aal2');
  assert.equal(req.authenticatedAt.toISOString(), '2023-11-14T22:13:20.000Z');
});

test('does not fall back to an application-signed token by default', async () => {
  let legacyVerifyCalled = false;
  const middleware = createAuthMiddleware({
    configuration: configuration(),
    supabaseClient: {
      auth: {
        async getUser() {
          return { data: {}, error: new Error('invalid') };
        },
      },
    },
    jwtLibrary: {
      verify() {
        legacyVerifyCalled = true;
        return { sub: 'legacy-user' };
      },
    },
  });
  const res = responseRecorder();

  await middleware(
    { headers: { authorization: 'Bearer invalid-token' } },
    res,
    () => assert.fail('next should not run')
  );

  assert.equal(legacyVerifyCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'INVALID_ACCESS_TOKEN');
});

test('allows legacy tokens only when explicitly enabled outside production', async () => {
  const middleware = createAuthMiddleware({
    configuration: configuration(true),
    supabaseClient: {
      auth: {
        async getUser() {
          return { data: {}, error: new Error('invalid') };
        },
      },
    },
    jwtLibrary: {
      verify(token) {
        assert.equal(token, 'legacy-token');
        return { sub: 'legacy-user' };
      },
    },
  });
  const req = { headers: { authorization: 'Bearer legacy-token' } };
  const res = responseRecorder();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user.sub, 'legacy-user');
  assert.equal(req.authenticationMethod, 'legacy-jwt');
});
