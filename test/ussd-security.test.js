const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  actionDigest,
  hashPin,
  normalizePhone,
  otpDigest,
  phoneDigest,
  verifyPin,
} = require('../services/ussdSecurity');
const { createAfricasTalkingAdapter } = require('../services/ussdProviderAdapter');
const { createUssdWebhookAuth } = require('../middleware/ussdWebhookAuth');

const SECRET = 'u'.repeat(32);

test('normalizes Nigerian phone numbers and produces a keyed route digest', () => {
  assert.equal(normalizePhone('0803 123 4567'), '+2348031234567');
  assert.equal(normalizePhone('2348031234567'), '+2348031234567');
  assert.equal(phoneDigest('+2348031234567', SECRET).length, 64);
  assert.throws(() => normalizePhone('1234'), { code: 'USSD_PHONE_INVALID' });
});

test('uses a salted memory-hard PIN hash and never stores the PIN', async () => {
  const encoded = await hashPin('4821', SECRET);
  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes('4821'), false);
  assert.equal(await verifyPin('4821', encoded, SECRET), true);
  assert.equal(await verifyPin('4822', encoded, SECRET), false);
});

test('binds an OTP digest to its challenge, purpose, and exact action', () => {
  const first = otpDigest('challenge-1', 'CONSENT_DECISION', '123456', SECRET);
  const second = otpDigest('challenge-2', 'CONSENT_DECISION', '123456', SECRET);
  assert.notEqual(first, second);
  assert.notEqual(
    actionDigest({ requestId: 'one', decision: 'APPROVE' }, SECRET),
    actionDigest({ requestId: 'one', decision: 'DECLINE' }, SECRET)
  );
});

test('parses the Africa’s Talking contract and emits bounded CON or END responses', () => {
  const adapter = createAfricasTalkingAdapter({ maxResponseCharacters: 80 });
  const request = adapter.parse({
    sessionId: 'session-1',
    serviceCode: '*347*215#',
    phoneNumber: '08031234567',
    text: '1*2',
  });
  assert.equal(request.phoneNumber, '+2348031234567');
  assert.deepEqual(request.inputs, ['1', '2']);
  assert.match(adapter.format({ continueSession: true, message: 'Choose an option' }), /^CON /);
  assert.match(adapter.format({ continueSession: false, message: 'Done' }), /^END /);
});

test('accepts only a fresh authentic gateway signature', () => {
  const timestamp = '1785348000';
  const rawBody = Buffer.from('sessionId=s1&phoneNumber=%2B2348031234567');
  const signature = crypto.createHmac('sha256', SECRET)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  let advanced = false;
  const middleware = createUssdWebhookAuth({
    secret: SECRET,
    now: () => new Date(Number(timestamp) * 1000),
  });
  const response = { status() { return this; }, type() { return this; }, send() { return this; } };
  middleware({
    rawBody,
    get(name) {
      return name === 'x-medfinet-ussd-timestamp' ? timestamp : signature;
    },
  }, response, () => { advanced = true; });
  assert.equal(advanced, true);
});
