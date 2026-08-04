const assert = require('node:assert/strict');
const test = require('node:test');
const { DomainError } = require('../utils/domainError');
const { createOutboxService, retryDelayMs } = require('../services/outboxService');

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
    actorSubjectId: 'system:worker-1',
    purpose: 'background-processing',
  };
}

function transaction(overrides = {}) {
  return { async $executeRawUnsafe() {}, ...overrides };
}

test('uses bounded exponential retry delays', () => {
  assert.equal(retryDelayMs(1), 1000);
  assert.equal(retryDelayMs(2), 2000);
  assert.equal(retryDelayMs(100), 60 * 60 * 1000);
});

test('claims one due event with an optimistic lock', async () => {
  const calls = [];
  const event = {
    id: 'event-1',
    organizationId: 'org-1',
    status: 'PENDING',
    attempts: 0,
  };
  const tx = transaction({
    outboxEvent: {
      async updateMany({ where, data }) {
        calls.push(['updateMany', where, data]);
        if (where.id === 'event-1') return { count: 1 };
        return { count: 0 };
      },
      async findFirst() {
        return event;
      },
      async findUnique() {
        return {
          ...event,
          status: 'PROCESSING',
          attempts: 1,
          lockedBy: 'worker-1',
        };
      },
    },
  });
  const service = createOutboxService(databaseWithTransaction(tx), {
    now: () => new Date('2026-07-29T01:00:00.000Z'),
  });

  const claimed = await service.claimNext(context(), 'worker-1');

  assert.equal(claimed.status, 'PROCESSING');
  assert.equal(claimed.attempts, 1);
  assert.equal(calls[1][2].lockedBy, 'worker-1');
});

test('publishes a successfully handled event', async () => {
  const updates = [];
  const tx = transaction({
    outboxEvent: {
      async updateMany({ where, data }) {
        if (!where.id) return { count: 0 };
        updates.push(data);
        return { count: 1 };
      },
      async findFirst() {
        return {
          id: 'event-1',
          organizationId: 'org-1',
          eventType: 'TEST_EVENT',
          status: 'PENDING',
          attempts: 0,
          payload: {},
        };
      },
      async findUnique() {
        return {
          id: 'event-1',
          organizationId: 'org-1',
          eventType: 'TEST_EVENT',
          status: 'PROCESSING',
          attempts: 1,
          lockedBy: 'worker-1',
          payload: {},
        };
      },
    },
  });
  let handled = false;
  const service = createOutboxService(databaseWithTransaction(tx), {
    handlers: {
      TEST_EVENT: async () => {
        handled = true;
      },
    },
  });

  const result = await service.processNext(context(), 'worker-1');

  assert.equal(handled, true);
  assert.equal(result.status, 'PUBLISHED');
  assert.equal(updates.at(-1).status, 'PUBLISHED');
});

test('dead-letters an event after its final failed attempt', async () => {
  const updates = [];
  const tx = transaction({
    outboxEvent: {
      async updateMany({ where, data }) {
        if (!where.id) return { count: 0 };
        updates.push(data);
        return { count: 1 };
      },
      async findFirst() {
        return {
          id: 'event-1',
          organizationId: 'org-1',
          eventType: 'TEST_EVENT',
          status: 'FAILED',
          attempts: 9,
          payload: {},
        };
      },
      async findUnique() {
        return {
          id: 'event-1',
          organizationId: 'org-1',
          eventType: 'TEST_EVENT',
          status: 'PROCESSING',
          attempts: 10,
          lockedBy: 'worker-1',
          payload: {},
        };
      },
    },
  });
  const service = createOutboxService(databaseWithTransaction(tx), {
    handlers: {
      TEST_EVENT: async () => {
        throw new DomainError(503, 'PROVIDER_DOWN', 'Provider unavailable');
      },
    },
  });

  const result = await service.processNext(context(), 'worker-1');

  assert.equal(result.status, 'DEAD_LETTER');
  assert.equal(updates.at(-1).status, 'DEAD_LETTER');
  assert.match(updates.at(-1).lastError, /PROVIDER_DOWN/);
});
