const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createNotificationQueueService,
} = require('../services/notificationQueueService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('queues one idempotent message and a scheduled dispatch event', async () => {
  const calls = [];
  const tx = {
    async $executeRawUnsafe() {},
    notificationPreference: {
      async findMany() {
        return [{
          subjectId: 'subject-1',
          category: 'REWARDS',
          channel: 'IN_APP',
          enabled: true,
          locale: 'en',
          timezone: 'UTC',
          quietHoursStart: null,
          quietHoursEnd: null,
        }];
      },
    },
    notificationMessage: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        calls.push(['message', data]);
        return { id: 'message-1', ...data };
      },
    },
    notificationTemplate: {
      async findFirst() {
        return {
          id: 'template-1',
          locale: 'en',
          variableNames: ['credits'],
          subject: null,
          body: 'You received {{credits}} credits',
        };
      },
    },
    outboxEvent: {
      async create({ data }) {
        calls.push(['outbox', data]);
      },
    },
    auditEvent: { async create() {} },
  };
  const service = createNotificationQueueService(databaseWithTransaction(tx), {
    now: () => new Date('2026-07-29T12:00:00.000Z'),
  });

  const messages = await service.queueRecipients(
    {
      organizationId: 'org-1',
      actorSubjectId: 'system:worker',
      purpose: 'background-processing',
    },
    'event-1',
    {
      templateKey: 'REWARD_GRANTED',
      category: 'REWARDS',
      recipients: [{ subjectId: 'subject-1', caregiverId: 'caregiver-1' }],
      variables: { credits: 25n },
    }
  );

  assert.equal(messages.length, 1);
  assert.equal(calls[0][1].renderedBody, 'You received 25 credits');
  assert.equal(calls[1][1].eventType, 'NOTIFICATION_DISPATCH_REQUESTED');
  assert.equal(
    calls[1][1].nextAttemptAt.toISOString(),
    '2026-07-29T12:00:00.000Z'
  );
});

test('respects explicit opt-out without silently enabling a default channel', async () => {
  let messageCreated = false;
  const tx = {
    async $executeRawUnsafe() {},
    notificationPreference: {
      async findMany() {
        return [{ channel: 'SMS', enabled: false }];
      },
    },
    notificationMessage: {
      async create() {
        messageCreated = true;
      },
    },
    auditEvent: { async create() {} },
  };
  const service = createNotificationQueueService(databaseWithTransaction(tx));
  const messages = await service.queueRecipients(
    {
      organizationId: 'org-1',
      actorSubjectId: 'system:worker',
      purpose: 'background-processing',
    },
    'event-1',
    {
      templateKey: 'REWARD_GRANTED',
      category: 'REWARDS',
      recipients: [{ subjectId: 'subject-1' }],
      variables: { credits: 25n },
    }
  );

  assert.equal(messages.length, 0);
  assert.equal(messageCreated, false);
});
