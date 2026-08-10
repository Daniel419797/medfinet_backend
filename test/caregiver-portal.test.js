const assert = require('node:assert/strict');
const test = require('node:test');
const { createCaregiverPortalService } = require('../services/caregiverPortalService');

function fakeDatabase(overrides = {}) {
  const calls = [];
  const transaction = {
    async $executeRawUnsafe() {},
    child: {
      async findFirst() {
        return { id: 'child-1', firstName: 'Ada', lastName: 'Okafor', medfinetId: 'MED-1' };
      },
    },
    organizationMembership: {
      async findUnique() {
        return null;
      },
      async upsert(args) {
        calls.push(['membership.upsert', args]);
        return { id: 'membership-1', role: 'CAREGIVER', status: 'ACTIVE' };
      },
    },
    caregiver: {
      async findUnique() {
        return null;
      },
      async findMany() {
        return [];
      },
      async create(args) {
        calls.push(['caregiver.create', args]);
        return { id: 'caregiver-1', ...args.data };
      },
      async update(args) {
        calls.push(['caregiver.update', args]);
        return { id: args.where.id, subjectId: 'subject-1', firstName: 'Parent', lastName: 'One', email: 'parent@example.com' };
      },
    },
    childCaregiver: {
      async upsert(args) {
        calls.push(['childCaregiver.upsert', args]);
        return {
          relationship: args.create.relationship,
          isPrimary: args.create.isPrimary,
          hasConsentAuthority: args.create.hasConsentAuthority,
        };
      },
    },
    auditEvent: {
      async create(args) {
        calls.push(['audit.create', args]);
      },
    },
    ...overrides,
  };
  return {
    calls,
    db: {
      async $transaction(operation) {
        return operation(transaction);
      },
    },
    transaction,
  };
}

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'admin-1',
  purpose: 'caregiver-portal-connection',
};

const input = {
  childId: 'child-1',
  firstName: 'Parent',
  lastName: 'One',
  relationship: 'MOTHER',
  preferredLanguage: 'en',
  isPrimary: true,
  hasConsentAuthority: true,
};

const account = { subjectId: 'subject-1', email: 'parent@example.com' };

test('connects a verified account, membership and child relationship atomically', async () => {
  const { db, calls } = fakeDatabase();
  const service = createCaregiverPortalService(db);

  const result = await service.connectParent(context, input, account);

  assert.equal(result.membership.role, 'CAREGIVER');
  assert.equal(result.child.id, 'child-1');
  assert.equal(result.relationship.relationship, 'MOTHER');
  assert.ok(calls.some(([name]) => name === 'caregiver.create'));
  assert.ok(calls.some(([name]) => name === 'membership.upsert'));
  assert.ok(calls.some(([name]) => name === 'childCaregiver.upsert'));
  assert.ok(calls.some(([name]) => name === 'audit.create'));
});

test('reuses one unlinked caregiver with the same verified email', async () => {
  const setup = fakeDatabase();
  setup.transaction.caregiver.findMany = async () => [{
    id: 'caregiver-existing',
    subjectId: null,
    email: 'parent@example.com',
  }];
  const service = createCaregiverPortalService(setup.db);

  await service.connectParent(context, input, account);

  assert.equal(setup.calls.some(([name]) => name === 'caregiver.create'), false);
  const update = setup.calls.find(([name]) => name === 'caregiver.update');
  assert.equal(update[1].where.id, 'caregiver-existing');
  assert.equal(update[1].data.subjectId, 'subject-1');
});

test('rejects an account that already has a non-caregiver organization role', async () => {
  const setup = fakeDatabase();
  setup.transaction.organizationMembership.findUnique = async () => ({ role: 'HEALTH_WORKER' });
  const service = createCaregiverPortalService(setup.db);

  await assert.rejects(
    () => service.connectParent(context, input, account),
    (error) => error.code === 'SUBJECT_HAS_DIFFERENT_ORGANIZATION_ROLE'
  );
});
