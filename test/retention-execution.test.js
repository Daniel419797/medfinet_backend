const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRetentionExecutionService,
} = require('../services/retentionExecutionService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('blocks approved retention when a legal hold is placed after preview', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    retentionExecutionRun: {
      async findFirst() {
        return {
          id: 'run-1',
          organizationId: 'org-1',
          status: 'APPROVED',
          cutoffAt: new Date('2025-01-01T00:00:00.000Z'),
          candidateCount: 3,
          policy: {
            recordCategory: 'PUBLISHED_OUTBOX',
            disposition: 'DELETE',
          },
        };
      },
    },
    legalHold: {
      async count() {
        return 1;
      },
    },
  };
  const service = createRetentionExecutionService(
    databaseWithTransaction(tx)
  );

  await assert.rejects(
    service.execute({
      organizationId: 'org-1',
      actorSubjectId: 'admin-3',
      purpose: 'data-governance',
    }, 'run-1'),
    (error) => error.code === 'RETENTION_BLOCKED_BY_LEGAL_HOLD'
  );
});
