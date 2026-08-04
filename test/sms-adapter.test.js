const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createBulkSmsNigeriaAdapter,
  createNotificationAdapters,
  toInternationalDigits,
} = require('../services/notificationAdapters');
const { createUssdOtpDeliveryService, otpMessageBody } = require('../services/ussdOtpDeliveryService');

const smsConfig = {
  provider: 'bulksmsnigeria',
  apiToken: 'secret-token',
  senderId: 'MEDFINET',
  gateway: 'direct-refund',
  baseUrl: 'https://www.bulksmsnigeria.com/api/sandbox/v2',
  callbackUrl: null,
  timeoutMs: 5000,
};

function responseWith(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test('normalizes Nigerian phone numbers to international digits', () => {
  assert.equal(toInternationalDigits('07012345678'), '2347012345678');
  assert.equal(toInternationalDigits('+2348012345678'), '2348012345678');
  assert.equal(toInternationalDigits('2349050030090'), '2349050030090');
  assert.equal(toInternationalDigits('0812 345 6789'), '2348123456789');
  assert.equal(toInternationalDigits('+1 555 555 5555'), null);
  assert.equal(toInternationalDigits(null), null);
});

test('posts the expected SMS payload without leaking the token', async () => {
  let request;
  const adapter = createBulkSmsNigeriaAdapter(smsConfig, {
    async fetchImpl(url, options) {
      request = { url, options };
      return responseWith(200, {
        status: 'success',
        data: { message_id: 'a22f907b-c5aa-44e4-89e4-06fe253e9cbb' },
      });
    },
  });

  const result = await adapter.send({
    message: {
      id: 'message-1',
      channel: 'SMS',
      renderedBody: 'Your child is due for a vaccine.',
    },
    destination: '07012345678',
  });

  assert.equal(request.url, 'https://www.bulksmsnigeria.com/api/sandbox/v2/sms');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, 'Bearer secret-token');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.from, 'MEDFINET');
  assert.equal(payload.to, '2347012345678');
  assert.equal(payload.body, 'Your child is due for a vaccine.');
  assert.equal(payload.gateway, 'direct-refund');
  assert.equal('api_token' in payload, false);
  assert.equal(String(request.options.body).includes('secret-token'), false);
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.providerMessageId, 'a22f907b-c5aa-44e4-89e4-06fe253e9cbb');
});

test('includes callback_url only when configured', async () => {
  let payload;
  const adapter = createBulkSmsNigeriaAdapter(
    { ...smsConfig, callbackUrl: 'https://api.example.com/v1/sms-callback' },
    {
      async fetchImpl(url, options) {
        payload = JSON.parse(options.body);
        return responseWith(200, { status: 'success', data: { message_id: 'm-1' } });
      },
    }
  );

  await adapter.send({
    message: { renderedBody: 'Hello' },
    destination: '2347012345678',
  });
  assert.equal(payload.callback_url, 'https://api.example.com/v1/sms-callback');
});

test('fails closed when the SMS provider is not configured', async () => {
  const adapter = createBulkSmsNigeriaAdapter({ ...smsConfig, apiToken: null });
  await assert.rejects(
    adapter.send({ message: { renderedBody: 'Hi' }, destination: '2347012345678' }),
    (error) => error.code === 'SMS_PROVIDER_NOT_CONFIGURED'
  );
});

test('rejects an invalid destination number', async () => {
  const adapter = createBulkSmsNigeriaAdapter(smsConfig, {
    async fetchImpl() {
      throw new Error('must not be called');
    },
  });
  await assert.rejects(
    adapter.send({ message: { renderedBody: 'Hi' }, destination: '+15555555555' }),
    (error) => error.code === 'SMS_DESTINATION_INVALID'
  );
});

test('surfaces provider rejections', async () => {
  const adapter = createBulkSmsNigeriaAdapter(smsConfig, {
    async fetchImpl() {
      return responseWith(400, { status: 'error', message: 'Insufficient balance' });
    },
  });
  await assert.rejects(
    adapter.send({ message: { renderedBody: 'Hi' }, destination: '2347012345678' }),
    (error) => error.code === 'SMS_PROVIDER_REJECTED'
  );
});

test('surfaces unreachable provider and invalid responses', async () => {
  const unreachable = createBulkSmsNigeriaAdapter(smsConfig, {
    async fetchImpl() {
      throw new Error('network down');
    },
  });
  await assert.rejects(
    unreachable.send({ message: { renderedBody: 'Hi' }, destination: '2347012345678' }),
    (error) => error.code === 'SMS_PROVIDER_UNREACHABLE'
  );

  const invalid = createBulkSmsNigeriaAdapter(smsConfig, {
    async fetchImpl() {
      return responseWith(200, { status: 'success', data: {} });
    },
  });
  await assert.rejects(
    invalid.send({ message: { renderedBody: 'Hi' }, destination: '2347012345678' }),
    (error) => error.code === 'SMS_PROVIDER_RESPONSE_INVALID'
  );
});

test('routes the SMS channel through BulkSMS when configured', () => {
  const adapters = createNotificationAdapters({ sms: smsConfig });
  assert.equal(adapters.SMS.name, 'bulksmsnigeria');
});

test('keeps the generic gateway for SMS when no provider is configured', () => {
  const adapters = createNotificationAdapters({ sms: { provider: null } });
  assert.equal(adapters.SMS.name, 'notification-gateway');
  assert.equal(adapters.EMAIL.name, 'notification-gateway');
});

test('renders a bounded OTP SMS body with the expiry minutes', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const expiresAt = new Date('2026-01-01T00:05:00Z');
  const body = otpMessageBody('123456', expiresAt, now.getTime());
  assert.match(body, /123456/);
  assert.match(body, /5 minute/);
});

test('delivers USSD OTPs through BulkSMS when configured', async () => {
  let payload;
  const deliver = createUssdOtpDeliveryService({
    config: { gatewayUrl: 'https://gateway.example.com', gatewayToken: 'gateway-token' },
    smsConfig,
    fetchImpl: async (url, options) => {
      payload = JSON.parse(options.body);
      return responseWith(200, { status: 'success', data: { message_id: 'm-1' } });
    },
  });

  await deliver({
    phone: '+2347012345678',
    code: '123456',
    idempotencyKey: 'ussd-otp:challenge-1',
    expiresAt: new Date('2026-01-01T00:05:00Z'),
  });

  assert.equal(payload.to, '2347012345678');
  assert.match(payload.body, /123456/);
});

test('falls back to the notification gateway for USSD OTPs without an SMS provider', async () => {
  let payload;
  const deliver = createUssdOtpDeliveryService({
    config: { gatewayUrl: 'https://gateway.example.com/v1', gatewayToken: 'gateway-token' },
    smsConfig: { provider: null },
    fetchImpl: async (url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 202 };
    },
  });

  await deliver({
    phone: '+2347012345678',
    code: '654321',
    idempotencyKey: 'ussd-otp:challenge-2',
    expiresAt: new Date('2026-01-01T00:05:00Z'),
  });

  assert.equal(payload.channel, 'SMS');
  assert.equal(payload.template, 'MEDFINET_USSD_OTP');
  assert.equal(payload.parameters.code, '654321');
});

test('wraps BulkSMS OTP failures as USSD_OTP_DELIVERY_FAILED', async () => {
  const deliver = createUssdOtpDeliveryService({
    config: { gatewayUrl: 'https://gateway.example.com', gatewayToken: 'gateway-token' },
    smsConfig,
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });

  await assert.rejects(
    deliver({
      phone: '+2347012345678',
      code: '123456',
      idempotencyKey: 'ussd-otp:challenge-3',
      expiresAt: new Date('2026-01-01T00:05:00Z'),
    }),
    (error) => error.code === 'USSD_OTP_DELIVERY_FAILED'
  );
});
