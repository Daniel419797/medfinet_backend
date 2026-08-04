const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createDataSubjectRequestService,
} = require('../services/dataSubjectRequestService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('accepts a caregiver request only for an authorized linked child', async () => {
  let created;
  const tx = {
    async $executeRawUnsafe() {},
    caregiver: {
      async findFirst() {
        return { id: 'caregiver-1', subjectId: 'subject-1' };
      },
    },
    child: {
      async findFirst() {
        return { id: 'child-1' };
      },
    },
    childCaregiver: {
      async findFirst() {
        return { id: 'link-1' };
      },
    },
    dataSubjectRequest: {
      async create({ data }) {
        created = { id: 'request-1', ...data };
        return created;
      },
    },
    auditEvent: { async create() {} },
  };
  const service = createDataSubjectRequestService(
    databaseWithTransaction(tx),
    { now: () => new Date('2026-07-29T12:00:00.000Z') }
  );

  const request = await service.submit({
    organizationId: 'org-1',
    actorSubjectId: 'subject-1',
    role: 'CAREGIVER',
    purpose: 'data-subject-rights',
  }, {
    caregiverId: 'caregiver-1',
    childId: 'child-1',
    requestType: 'ACCESS',
    requestDetails: 'Please provide a copy of the child record.',
  });

  assert.equal(request.id, 'request-1');
  assert.equal(created.dueAt.toISOString(), '2026-08-28T12:00:00.000Z');
});

test('requires a different worker to verify a subject request', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    dataSubjectRequest: {
      async findFirst() {
        return {
          id: 'request-1',
          status: 'RECEIVED',
          submittedBySubjectId: 'admin-1',
        };
      },
    },
  };
  const service = createDataSubjectRequestService(
    databaseWithTransaction(tx)
  );

  await assert.rejects(
    service.verifyIdentity({
      organizationId: 'org-1',
      actorSubjectId: 'admin-1',
      role: 'ADMIN',
      purpose: 'data-subject-rights',
    }, 'request-1'),
    (error) => (
      error.code === 'DATA_SUBJECT_REQUEST_MAKER_CHECKER_REQUIRED'
    )
  );
});
