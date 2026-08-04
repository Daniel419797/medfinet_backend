const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createChildIdentityAmendmentService,
  normalizeProposedData,
} = require('../services/childIdentityAmendmentService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('normalizes only explicitly proposed child identity fields', () => {
  assert.deepEqual(normalizeProposedData({
    firstName: ' Ada ',
    dateOfBirth: '2020-01-02',
  }), {
    firstName: 'Ada',
    dateOfBirth: '2020-01-02',
  });
  assert.throws(
    () => normalizeProposedData({}),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('requires a different authorized reviewer for identity corrections', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    childIdentityAmendment: {
      async findFirst() {
        return {
          id: 'amendment-1',
          status: 'PENDING',
          requestedBySubjectId: 'worker-1',
        };
      },
    },
  };
  const service = createChildIdentityAmendmentService(
    databaseWithTransaction(tx)
  );

  await assert.rejects(
    service.review({
      organizationId: 'org-1',
      actorSubjectId: 'worker-1',
      purpose: 'identity-correction',
    }, 'amendment-1', {
      decision: 'APPLY',
      reviewReason: 'Verified against source documents',
    }),
    (error) => error.code === 'IDENTITY_AMENDMENT_MAKER_CHECKER_REQUIRED'
  );
});

test('refuses to apply a correction that creates a duplicate identity', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    childIdentityAmendment: {
      async findFirst() {
        return {
          id: 'amendment-1',
          childId: 'child-1',
          status: 'PENDING',
          requestedBySubjectId: 'worker-1',
          proposedData: { firstName: 'Ada' },
        };
      },
    },
    child: {
      async findFirst() {
        return {
          id: 'child-1',
          firstName: 'Adaa',
          lastName: 'Okafor',
          dateOfBirth: new Date('2020-01-02T00:00:00.000Z'),
          sex: 'FEMALE',
        };
      },
      async count() {
        return 1;
      },
    },
  };
  const service = createChildIdentityAmendmentService(
    databaseWithTransaction(tx)
  );

  await assert.rejects(
    service.review({
      organizationId: 'org-1',
      actorSubjectId: 'admin-2',
      purpose: 'identity-correction',
    }, 'amendment-1', {
      decision: 'APPLY',
      reviewReason: 'Verified against source documents',
    }),
    (error) => error.code === 'IDENTITY_AMENDMENT_DUPLICATE_CONFLICT'
  );
});
