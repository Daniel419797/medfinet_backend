const assert = require('node:assert/strict');
const test = require('node:test');
const { requestContext } = require('../middleware/requestContext');

function responseRecorder() {
  return {
    headers: {},
    set(name, value) {
      this.headers[name] = value;
    },
  };
}

test('preserves a safe upstream request ID', () => {
  const req = { get: () => 'gateway:request-1' };
  const res = responseRecorder();
  let nextCalled = false;

  requestContext(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.requestId, 'gateway:request-1');
  assert.equal(res.headers['x-request-id'], 'gateway:request-1');
});

test('replaces an unsafe request ID with a UUID', () => {
  const req = { get: () => 'unsafe request id with spaces' };
  const res = responseRecorder();

  requestContext(req, res, () => {});

  assert.match(
    req.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.equal(res.headers['x-request-id'], req.requestId);
});
