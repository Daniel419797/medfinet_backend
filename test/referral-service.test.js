const assert = require('node:assert/strict');
const test = require('node:test');
const { createReferralService } = require('../services/referralService');

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
    actorSubjectId: 'worker-1',
    role: 'HEALTH_WORKER',
    purpose: 'climate-response',
  };
}

function transaction(overrides = {}) {
  return {
    async $executeRawUnsafe() {},
    outboxEvent: { async create() {} },
    ...overrides,
  };
}

test('opens an idempotent referral from an authorized eligible worklist entry', async () => {
  const calls = [];
  const tx = transaction({
    referral: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        calls.push(['referral', data]);
        return { id: 'referral-1', status: 'OPEN', ...data };
      },
    },
    worklistEntry: {
      async findFirst() {
        return {
          id: 'entry-1',
          childId: 'child-1',
          worklist: { id: 'worklist-1', status: 'AUTHORIZED' },
        };
      },
      async update({ data }) {
        calls.push(['entry', data]);
      },
    },
    beneficiaryWorklist: {
      async update({ data }) {
        calls.push(['worklist', data]);
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createReferralService(
    databaseWithTransaction(tx),
    { now: () => new Date('2026-07-28T16:00:00.000Z') }
  );

  const result = await service.createReferral(context(), 'entry-1', {
    sourceOperationId: 'device-referral-1',
    referralType: 'ACUTE_MALNUTRITION',
    destination: 'Ikeja PHC',
    priority: 'CRITICAL',
    reason: 'MUAC requires urgent assessment',
  });

  assert.equal(result.idempotentReplay, false);
  assert.equal(result.referral.childId, 'child-1');
  assert.equal(calls[1][1].status, 'REFERRED');
  assert.equal(calls[2][1].status, 'ACTIVE');
  assert.equal(calls[3][1].action, 'referral.opened');
});

test('requires closure evidence for terminal referral transitions', async () => {
  const tx = transaction({
    referral: {
      async findFirst() {
        return {
          id: 'referral-1',
          childId: 'child-1',
          status: 'ACCEPTED',
        };
      },
    },
  });
  const service = createReferralService(databaseWithTransaction(tx));

  await assert.rejects(
    service.transitionReferral(context(), 'referral-1', {
      status: 'COMPLETED',
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('completes a referral with closure and audit evidence', async () => {
  const calls = [];
  const tx = transaction({
    referral: {
      async findFirst() {
        return {
          id: 'referral-1',
          childId: 'child-1',
          status: 'ACCEPTED',
        };
      },
      async update({ data }) {
        calls.push(['update', data]);
        return { id: 'referral-1', childId: 'child-1', ...data };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createReferralService(
    databaseWithTransaction(tx),
    { now: () => new Date('2026-07-28T17:00:00.000Z') }
  );

  const result = await service.transitionReferral(context(), 'referral-1', {
    status: 'COMPLETED',
    closureNotes: 'Child assessed and treatment initiated',
  });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.closedBySubjectId, 'worker-1');
  assert.equal(calls[1][1].action, 'referral.status-changed');
});
