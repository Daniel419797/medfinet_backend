const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRateLimitMiddleware,
  hashRateLimitKey,
} = require('../middleware/rateLimit');

function responseRecorder() {
  const headers = {};
  return {
    headers,
    set(name, value) {
      headers[name] = value;
    },
  };
}

test('stores only a keyed hash and returns standard limit headers', async () => {
  let parameters;
  const database = {
    async $queryRawUnsafe(_sql, ...values) {
      parameters = values;
      return [{ requestCount: 2 }];
    },
  };
  const middleware = createRateLimitMiddleware({
    scope: 'public',
    limit: 3,
    windowMs: 60000,
  }, {
    prismaClient: database,
    pepper: 'a-test-rate-limit-pepper-with-at-least-32-characters',
    now: () => new Date('2026-07-29T12:00:30.000Z'),
  });
  const response = responseRecorder();
  let nextError;

  await middleware(
    { ip: '203.0.113.5' },
    response,
    (error) => { nextError = error; }
  );

  assert.equal(nextError, undefined);
  assert.equal(parameters[0], 'public');
  assert.match(parameters[1], /^[a-f0-9]{64}$/);
  assert.equal(parameters.join(' ').includes('203.0.113.5'), false);
  assert.equal(response.headers['RateLimit-Remaining'], '1');
});

test('rejects requests over the distributed bucket limit', async () => {
  const middleware = createRateLimitMiddleware({
    scope: 'auth',
    limit: 1,
    windowMs: 60000,
  }, {
    prismaClient: {
      async $queryRawUnsafe() {
        return [{ requestCount: 2 }];
      },
    },
    pepper: 'a-test-rate-limit-pepper-with-at-least-32-characters',
    now: () => new Date('2026-07-29T12:00:30.000Z'),
  });
  const response = responseRecorder();
  let nextError;

  await middleware(
    { ip: '203.0.113.5' },
    response,
    (error) => { nextError = error; }
  );

  assert.equal(nextError.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(nextError.status, 429);
  assert.equal(response.headers['Retry-After'], '30');
});

test('uses scope-separated hashes for the same network address', () => {
  const pepper = 'a-test-rate-limit-pepper-with-at-least-32-characters';
  assert.notEqual(
    hashRateLimitKey(pepper, 'public:203.0.113.5'),
    hashRateLimitKey(pepper, 'auth:203.0.113.5')
  );
});
