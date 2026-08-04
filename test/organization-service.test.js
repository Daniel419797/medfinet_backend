const assert = require('node:assert/strict');
const test = require('node:test');
const { createOrganizationService, normalizedCode } = require('../services/organizationService');

function databaseWithTransaction(transaction) {
  return { async $transaction(operation) { return operation(transaction); } };
}

const context = {
  organizationId: 'org-safe',
  actorSubjectId: 'admin-1',
  actorRole: 'ADMIN',
  purpose: 'organization-administration',
};

test('normalizes resource codes and rejects unsafe formats', () => {
  assert.equal(normalizedCode(' clinic-01 '), 'CLINIC-01');
  assert.throws(() => normalizedCode('clinic 01'), /letters, numbers/);
});

test('lists only active organization memberships for the authenticated subject', async () => {
  let query;
  const service = createOrganizationService({
    organizationMembership: {
      async findMany(input) {
        query = input;
        return [{ id: 'membership-1', role: 'HEALTH_WORKER', organization: { id: 'org-safe' } }];
      },
    },
  });

  const records = await service.listMyOrganizations('subject-1');

  assert.equal(query.where.subjectId, 'subject-1');
  assert.equal(query.where.status, 'ACTIVE');
  assert.equal(query.select.organization.select.name, true);
  assert.equal(records[0].organization.id, 'org-safe');
});

test('upserts membership only into the verified organization and audits it', async () => {
  const calls = [];
  const transaction = {
    async $executeRawUnsafe(query, organizationId) { calls.push(['context', organizationId]); },
    organizationMembership: {
      async findUnique() { return null; },
      async upsert(input) {
        calls.push(['membership', input]);
        return { id: 'membership-1', ...input.create };
      },
    },
    auditEvent: { async create(input) { calls.push(['audit', input]); } },
  };
  const service = createOrganizationService(databaseWithTransaction(transaction));

  await service.upsertMembership(context, { subjectId: 'worker-2', role: 'HEALTH_WORKER' });

  assert.equal(calls[0][1], 'org-safe');
  assert.equal(calls[1][1].create.organizationId, 'org-safe');
  assert.equal(calls[2][1].data.action, 'membership.upserted');
});

test('prevents an administrator from granting or modifying owner access', async () => {
  const transaction = {
    async $executeRawUnsafe() {},
    organizationMembership: {
      async findUnique() { return null; },
      async upsert() { throw new Error('must not escalate administrator access'); },
    },
  };
  const service = createOrganizationService(databaseWithTransaction(transaction));

  await assert.rejects(
    service.upsertMembership(context, { subjectId: 'admin-1', role: 'OWNER' }),
    (error) => error.code === 'OWNER_ROLE_REQUIRED' && error.status === 403
  );
});

test('prevents removal of the final active owner', async () => {
  const transaction = {
    async $executeRawUnsafe() {},
    organizationMembership: {
      async findUnique() { return { role: 'OWNER' }; },
      async count() { return 1; },
      async upsert() { throw new Error('must retain the final owner'); },
    },
  };
  const service = createOrganizationService(databaseWithTransaction(transaction));

  await assert.rejects(
    service.upsertMembership(
      { ...context, actorRole: 'OWNER' },
      { subjectId: 'owner-1', role: 'OWNER', status: 'REVOKED' }
    ),
    (error) => error.code === 'LAST_OWNER_REQUIRED' && error.status === 409
  );
});

test('facility creation is tenant scoped and audited', async () => {
  let createData;
  const transaction = {
    async $executeRawUnsafe() {},
    facility: {
      async create({ data }) { createData = data; return { id: 'facility-1', ...data }; },
    },
    auditEvent: { async create() {} },
  };
  const service = createOrganizationService(databaseWithTransaction(transaction));

  await service.createFacility(context, { name: 'Central Clinic', code: 'cc-1' });

  assert.equal(createData.organizationId, 'org-safe');
  assert.equal(createData.code, 'CC-1');
});

test('programme dates must be chronological', async () => {
  const service = createOrganizationService({});
  await assert.rejects(
    service.createProgramme(context, {
      name: 'Nutrition',
      code: 'NUTRITION',
      startsAt: '2026-08-02T00:00:00Z',
      endsAt: '2026-08-01T00:00:00Z',
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});
