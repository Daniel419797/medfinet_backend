const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRetentionPolicyService,
  normalizePolicy,
} = require('../services/retentionPolicyService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'admin-2',
  purpose: 'data-governance',
};

test('allows deletion only for explicitly safe operational categories', () => {
  assert.equal(normalizePolicy({
    recordCategory: 'NOTIFICATION_ATTEMPT',
    retentionDays: 365,
    disposition: 'DELETE',
    legalBasis: 'Approved operations schedule',
  }).disposition, 'DELETE');
  assert.throws(
    () => normalizePolicy({
      recordCategory: 'CLINICAL_RECORD',
      retentionDays: 365,
      disposition: 'DELETE',
      legalBasis: 'Unsafe automatic deletion',
    }),
    (error) => error.code === 'UNSAFE_RETENTION_DISPOSITION'
  );
});

test('requires a different administrator to activate retention policy', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    dataRetentionPolicy: {
      async findFirst() {
        return {
          id: 'policy-1',
          organizationId: 'org-1',
          recordCategory: 'PUBLISHED_OUTBOX',
          status: 'DRAFT',
          createdBySubjectId: 'admin-2',
        };
      },
    },
  };
  await assert.rejects(
    createRetentionPolicyService(databaseWithTransaction(tx)).activate(
      context,
      'policy-1'
    ),
    (error) => error.code === 'RETENTION_POLICY_MAKER_CHECKER_REQUIRED'
  );
});
