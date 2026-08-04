const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createNotificationDispatchService,
  destination,
} = require('../services/notificationDispatchService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

function context() {
  return {
    organizationId: 'org-1',
    actorSubjectId: 'system:worker',
    purpose: 'background-processing',
  };
}

test('selects contact destinations without persisting them in attempts', () => {
  assert.equal(
    destination({ channel: 'EMAIL', caregiver: { email: 'a@example.com' } }),
    'a@example.com'
  );
  assert.equal(
    destination({ channel: 'SMS', caregiver: { phone: '+2348000000000' } }),
    '+2348000000000'
  );
});

test('claims and completes an in-app delivery idempotently', async () => {
  const calls = [];
  const message = {
    id: 'message-1',
    organizationId: 'org-1',
    recipientSubjectId: 'subject-1',
    category: 'REWARDS',
    channel: 'IN_APP',
    status: 'QUEUED',
    idempotencyKey: 'event:subject:IN_APP',
    caregiver: null,
  };
  const tx = {
    async $executeRawUnsafe() {},
    notificationMessage: {
      async findFirst({ where }) {
        return where.status ? message : null;
      },
      async updateMany() {
        return { count: 1 };
      },
      async update({ data }) {
        calls.push(['message', data]);
        return { ...message, ...data };
      },
    },
    notificationPreference: { async findUnique() { return null; } },
    notificationDeliveryAttempt: {
      async count() { return 0; },
      async create({ data }) {
        return { id: 'attempt-1', ...data };
      },
      async update({ data }) {
        calls.push(['attempt', data]);
      },
    },
  };
  const service = createNotificationDispatchService(
    databaseWithTransaction(tx),
    {
      now: () => new Date('2026-07-29T12:00:00.000Z'),
      adapters: {
        IN_APP: {
          name: 'in-app',
          async send() {
            return {
              status: 'DELIVERED',
              providerMessageId: 'in-app:message-1',
              responseCode: 'INTERNAL',
            };
          },
        },
      },
    }
  );

  const result = await service.dispatch(context(), 'message-1');

  assert.equal(result.message.status, 'DELIVERED');
  assert.equal(calls[0][1].status, 'DELIVERED');
  assert.equal(calls[1][1].deliveredAt instanceof Date, true);
});
