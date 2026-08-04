const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { createUssdIngressApp } = require('../gateway/ussdIngress');

const settings = {
  providerCallbackToken: 'provider-token-that-is-longer-than-32-characters',
  webhookSecret: 'webhook-secret-that-is-longer-than-32-characters',
  backendWebhookUrl: 'https://backend.example.test/ussd',
};

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('ingress preserves the form body and signs it for the internal webhook', async () => {
  let forwarded;
  const app = createUssdIngressApp({ settings, logger: { error() {} }, fetchImpl: async (url, options) => {
    forwarded = { url, options };
    return { ok: true, text: async () => 'CON Medfinet\n1 Appointments' };
  } });
  await withServer(app, async (baseUrl) => {
    const body = 'sessionId=s1&serviceCode=*123%23&phoneNumber=%2B2348012345678&text=';
    const result = await fetch(`${baseUrl}/callback/${settings.providerCallbackToken}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    assert.equal(result.status, 200);
    assert.equal(await result.text(), 'CON Medfinet\n1 Appointments');
    assert.equal(forwarded.url, settings.backendWebhookUrl);
    assert.equal(Buffer.from(forwarded.options.body).toString(), body);
    const timestamp = forwarded.options.headers['x-medfinet-ussd-timestamp'];
    const expected = crypto.createHmac('sha256', settings.webhookSecret)
      .update(`${timestamp}.`).update(body).digest('hex');
    assert.equal(forwarded.options.headers['x-medfinet-ussd-signature'], expected);
  });
});

test('ingress hides the callback when its path token is wrong', async () => {
  let called = false;
  const app = createUssdIngressApp({ settings, logger: { error() {} }, fetchImpl: async () => { called = true; } });
  await withServer(app, async (baseUrl) => {
    const result = await fetch(`${baseUrl}/callback/wrong`, {
      method: 'POST', body: 'sessionId=s1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(result.status, 404);
    assert.equal(called, false);
  });
});

test('ingress fails safely when the backend response violates the USSD contract', async () => {
  const app = createUssdIngressApp({ settings, logger: { error() {} }, fetchImpl: async () => ({
    ok: true, text: async () => '<html>unexpected</html>',
  }) });
  await withServer(app, async (baseUrl) => {
    const result = await fetch(`${baseUrl}/callback/${settings.providerCallbackToken}`, {
      method: 'POST', body: 'sessionId=s1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(await result.text(), 'END Service temporarily unavailable');
  });
});
