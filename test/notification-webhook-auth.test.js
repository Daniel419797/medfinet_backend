const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  createNotificationWebhookAuth,
  parseSignature,
} = require('../middleware/notificationWebhookAuth');

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('accepts a fresh authentic raw-body signature', () => {
  const secret = 'a-webhook-secret-with-more-than-32-characters';
  const timestamp = '1785326400';
  const rawBody = Buffer.from('{"messageId":"provider-1"}');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  const req = {
    rawBody,
    get() {
      return `t=${timestamp},v1=${signature}`;
    },
  };
  let continued = false;

  createNotificationWebhookAuth({
    secret,
    now: () => new Date(Number(timestamp) * 1000),
  })(req, response(), () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.deepEqual(parseSignature(`t=${timestamp},v1=${signature}`), {
    timestamp,
    signature,
  });
});

test('rejects stale webhook signatures before processing callbacks', () => {
  const req = {
    rawBody: Buffer.from('{}'),
    get() {
      return `t=1,v1=${'a'.repeat(64)}`;
    },
  };
  const res = response();

  createNotificationWebhookAuth({
    secret: 'a-webhook-secret-with-more-than-32-characters',
    now: () => new Date('2026-07-29T12:00:00.000Z'),
  })(req, res, () => {});

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.code, 'WEBHOOK_SIGNATURE_INVALID');
});
