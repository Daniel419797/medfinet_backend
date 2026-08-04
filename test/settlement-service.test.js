const assert = require('node:assert/strict');
const test = require('node:test');
const { createSettlementService } = require('../services/settlementService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

function context(subject = 'admin-2') {
  return {
    organizationId: 'org-1',
    actorSubjectId: subject,
    purpose: 'merchant-settlement',
  };
}

test('requires a different administrator to approve a settlement', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    async $queryRawUnsafe() {},
    settlementBatch: {
      async findFirst() {
        return {
          id: 'batch-1',
          status: 'DRAFT',
          createdBySubjectId: 'admin-1',
        };
      },
    },
  };
  const service = createSettlementService(databaseWithTransaction(tx));

  await assert.rejects(
    service.approveBatch(context('admin-1'), 'batch-1'),
    (error) => error.code === 'SETTLEMENT_MAKER_CHECKER_REQUIRED'
  );
});

test('assigns each unsettled redemption to one deterministic batch', async () => {
  const calls = [];
  const tx = {
    async $executeRawUnsafe() {},
    async $queryRawUnsafe() {},
    merchant: {
      async findFirst() {
        return { id: 'merchant-1', status: 'ACTIVE' };
      },
    },
    settlementBatch: {
      async findFirst() {
        return null;
      },
      async create({ data }) {
        calls.push(['batch', data]);
        return { id: 'batch-1', ...data };
      },
    },
    rewardRedemption: {
      async findMany() {
        return [
          { id: 'redemption-1', amount: 25n },
          { id: 'redemption-2', amount: 35n },
        ];
      },
      async updateMany({ where, data }) {
        calls.push(['assign', { where, data }]);
        return { count: 2 };
      },
    },
    auditEvent: { async create() {} },
  };
  const service = createSettlementService(databaseWithTransaction(tx));
  const batch = await service.createBatch(context(), 'merchant-1', {
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  });

  assert.equal(batch.totalCredits, 60n);
  assert.equal(batch.redemptionCount, 2);
  assert.equal(calls[1][1].data.settlementBatchId, 'batch-1');
  assert.deepEqual(calls[1][1].where.id.in, ['redemption-1', 'redemption-2']);
});
