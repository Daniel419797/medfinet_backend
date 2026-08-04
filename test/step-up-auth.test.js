const assert = require('node:assert/strict');
const test = require('node:test');
const { createStepUpAuthMiddleware } = require('../middleware/stepUpAuth');

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

test('requires a recent Supabase aal2 authentication', () => {
  const middleware = createStepUpAuthMiddleware({
    now: () => new Date('2026-07-28T12:10:00.000Z'),
  });
  const req = {
    authenticationMethod: 'supabase',
    authenticationAssurance: 'aal2',
    authenticatedAt: new Date('2026-07-28T12:05:00.000Z'),
    requestId: 'request-1',
  };
  const res = responseRecorder();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test('rejects aal1, legacy, missing, future, and stale authentication', () => {
  const middleware = createStepUpAuthMiddleware({
    now: () => new Date('2026-07-28T12:10:00.000Z'),
  });
  const cases = [
    ['supabase', 'aal1', new Date('2026-07-28T12:05:00.000Z')],
    ['legacy-jwt', 'aal2', new Date('2026-07-28T12:05:00.000Z')],
    ['supabase', 'aal2', null],
    ['supabase', 'aal2', new Date('2026-07-28T12:11:00.000Z')],
    ['supabase', 'aal2', new Date('2026-07-28T11:59:59.000Z')],
  ];

  for (const [authenticationMethod, authenticationAssurance, authenticatedAt] of cases) {
    const res = responseRecorder();
    middleware(
      {
        authenticationMethod,
        authenticationAssurance,
        authenticatedAt,
        requestId: 'request-denied',
      },
      res,
      () => assert.fail('next should not run')
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'STEP_UP_AUTHENTICATION_REQUIRED');
    assert.equal(res.body.requestId, 'request-denied');
  }
});
