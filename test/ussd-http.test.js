const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { once } = require('node:events');
const { createUssdWebhookAuth } = require('../middleware/ussdWebhookAuth');
const { createUssdWebhookController } = require('../controllers/ussdWebhook');

async function serve(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, 'close'); }
}

function signedHeaders(rawBody, secret, timestamp) {
  return {
    'content-type': 'application/x-www-form-urlencoded',
    'x-medfinet-ussd-timestamp': timestamp,
    'x-medfinet-ussd-signature': crypto.createHmac('sha256', secret)
      .update(`${timestamp}.`).update(rawBody).digest('hex'),
  };
}

test('signed Africa Talking form reaches the canonical engine and returns text/plain CON', async () => {
  const secret = 'http-webhook-secret-that-is-at-least-32-characters';
  let received;
  const app = express();
  app.use(express.urlencoded({ extended: true, verify(req, _res, buffer) { req.rawBody = Buffer.from(buffer); } }));
  app.post('/api/v1/webhooks/ussd/africas-talking',
    createUssdWebhookAuth({ secret }),
    createUssdWebhookController({
      engine: { handle: async (body) => { received = body; return 'CON Medfinet\n1 Appointments'; } },
      logger: { warn() {} },
    }));
  await serve(app, async (baseUrl) => {
    const rawBody = 'sessionId=session-1&serviceCode=*123%23&phoneNumber=%2B2348012345678&text=';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(`${baseUrl}/api/v1/webhooks/ussd/africas-talking`, {
      method: 'POST', headers: signedHeaders(rawBody, secret, timestamp), body: rawBody,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.equal(await response.text(), 'CON Medfinet\n1 Appointments');
    assert.equal(received.sessionId, 'session-1');
    assert.equal(received.phoneNumber, '+2348012345678');
  });
});

test('unsigned or stale HTTP callbacks fail before the engine runs', async () => {
  const secret = 'http-webhook-secret-that-is-at-least-32-characters';
  let calls = 0;
  const app = express();
  app.use(express.urlencoded({ extended: false, verify(req, _res, buffer) { req.rawBody = Buffer.from(buffer); } }));
  app.post('/ussd', createUssdWebhookAuth({ secret }), createUssdWebhookController({
    engine: { handle: async () => { calls += 1; return 'CON Unexpected'; } },
    logger: { warn() {} },
  }));
  await serve(app, async (baseUrl) => {
    const rawBody = 'sessionId=session-1';
    const unsigned = await fetch(`${baseUrl}/ussd`, { method: 'POST', body: rawBody });
    assert.equal(unsigned.status, 401);
    const old = String(Math.floor(Date.now() / 1000) - 500);
    const stale = await fetch(`${baseUrl}/ussd`, {
      method: 'POST', headers: signedHeaders(rawBody, secret, old), body: rawBody,
    });
    assert.equal(stale.status, 401);
    assert.equal(calls, 0);
  });
});
