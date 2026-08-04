const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGatewayAdapter,
  createInAppAdapter,
} = require('../services/notificationAdapters');

test('delivers in-app messages without an external destination', async () => {
  const result = await createInAppAdapter().send({
    message: { id: 'message-1' },
  });
  assert.equal(result.status, 'DELIVERED');
  assert.equal(result.providerMessageId, 'in-app:message-1');
});

test('sends a bounded idempotent gateway request without leaking its token', async () => {
  let request;
  const adapter = createGatewayAdapter(
    {
      gatewayUrl: 'https://notifications.example.com/v1/messages',
      gatewayToken: 'secret-token',
    },
    {
      async fetchImpl(url, options) {
        request = { url, options };
        return {
          ok: true,
          status: 202,
          async json() {
            return { messageId: 'provider-1', delivered: false };
          },
        };
      },
    }
  );

  const result = await adapter.send({
    message: {
      id: 'message-1',
      organizationId: 'org-1',
      channel: 'SMS',
      idempotencyKey: 'event:subject:SMS',
      renderedSubject: null,
      renderedBody: 'A safe notification',
    },
    destination: '+2348000000000',
  });

  assert.equal(result.status, 'ACCEPTED');
  assert.equal(request.options.headers['idempotency-key'], 'event:subject:SMS');
  assert.equal(JSON.parse(request.options.body).metadata.organizationId, 'org-1');
  assert.equal(JSON.stringify(request.options.body).includes('secret-token'), false);
});
