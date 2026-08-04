const assert = require('node:assert/strict');
const test = require('node:test');
const { createIdentityService, parseDateOfBirth } = require('../services/identityService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) { return operation(transaction); },
  };
}

function context(organizationId = 'org-1') {
  return {
    organizationId,
    actorSubjectId: 'worker-1',
    purpose: 'continuity-of-care',
  };
}

test('validates calendar dates and rejects future dates', () => {
  assert.equal(parseDateOfBirth('2020-02-29').toISOString().slice(0, 10), '2020-02-29');
  assert.throws(() => parseDateOfBirth('2021-02-29'), /not a valid date/);
  assert.throws(() => parseDateOfBirth('2999-01-01'), /cannot be in the future/);
});

test('creates an organization with owner access and operational notification templates', async () => {
  let templates;
  const transaction = {
    organization: {
      async create({ data }) {
        return { id: 'org-1', ...data };
      },
    },
    organizationMembership: { async create() {} },
    async $executeRawUnsafe() {},
    notificationTemplate: {
      async createMany({ data }) {
        templates = data;
      },
    },
    auditEvent: { async create() {} },
  };
  const service = createIdentityService(databaseWithTransaction(transaction));

  const organization = await service.createOrganization({
    actorSubjectId: 'owner-1',
    name: 'Northern Health Network',
    slug: 'northern-health-network',
  });

  assert.equal(organization.id, 'org-1');
  assert.equal(templates.length >= 8, true);
  assert.equal(templates.every(({ organizationId }) => organizationId === 'org-1'), true);
  assert.equal(templates.every(({ status }) => status === 'ACTIVE'), true);
});

test('creates a child and audit event inside a tenant-scoped transaction', async () => {
  const calls = [];
  const transaction = {
    async $executeRawUnsafe(query, organizationId) { calls.push(['context', query, organizationId]); },
    child: {
      async findMany() { return []; },
      async create({ data }) {
        calls.push(['child', data]);
        return { id: 'child-1', ...data };
      },
    },
    auditEvent: {
      async create({ data }) { calls.push(['audit', data]); },
    },
  };
  const service = createIdentityService(databaseWithTransaction(transaction));

  const child = await service.createChild(context(), {
    firstName: ' Amina ',
    lastName: ' Musa ',
    dateOfBirth: '2024-05-12',
    sex: 'FEMALE',
  });

  assert.equal(calls[0][0], 'context');
  assert.equal(calls[0][2], 'org-1');
  assert.equal(calls[1][1].organizationId, 'org-1');
  assert.equal(calls[1][1].firstName, 'Amina');
  assert.match(child.medfinetId, /^MED-/);
  assert.equal(calls[2][1].action, 'child.created');
  assert.equal(calls[2][1].purpose, 'continuity-of-care');
});

test('requires explicit review before creating a possible duplicate child', async () => {
  const transaction = {
    async $executeRawUnsafe() {},
    child: {
      async findMany({ where }) {
        assert.equal(where.organizationId, 'org-1');
        return [{ id: 'existing-1', medfinetId: 'MED-existing' }];
      },
      async create() { throw new Error('must not create an unreviewed duplicate'); },
    },
  };
  const service = createIdentityService(databaseWithTransaction(transaction));

  await assert.rejects(
    service.createChild(context(), {
      firstName: 'Amina',
      lastName: 'Musa',
      dateOfBirth: '2024-05-12',
      sex: 'FEMALE',
    }),
    (error) => error.code === 'POSSIBLE_DUPLICATE' && error.details.candidates[0].id === 'existing-1'
  );
});

test('creates a reviewed distinct child even when names and date of birth match', async () => {
  let created = false;
  const transaction = {
    async $executeRawUnsafe() {},
    child: {
      async findMany() { return [{ id: 'twin-1', medfinetId: 'MED-twin' }]; },
      async create({ data }) { created = true; return { id: 'twin-2', ...data }; },
    },
    auditEvent: { async create() {} },
  };
  const service = createIdentityService(databaseWithTransaction(transaction));

  await service.createChild(context(), {
    firstName: 'Amina',
    lastName: 'Musa',
    dateOfBirth: '2024-05-12',
    sex: 'FEMALE',
    confirmedDistinctFromIds: ['twin-1'],
  });

  assert.equal(created, true);
});

test('always filters child lists by the verified organization', async () => {
  let query;
  const transaction = {
    async $executeRawUnsafe() {},
    child: {
      async findMany(input) { query = input; return []; },
    },
    auditEvent: { async create() {} },
  };
  const service = createIdentityService(databaseWithTransaction(transaction));

  await service.listChildren(context('org-safe'), { limit: 500 });

  assert.equal(query.where.organizationId, 'org-safe');
  assert.equal(query.take, 101);
});

test('limits caregiver child lists to records linked to their authenticated subject', async () => {
  let query;
  const transaction = {
    async $executeRawUnsafe() {},
    child: { async findMany(input) { query = input; return []; } },
    auditEvent: { async create() {} },
  };
  const service = createIdentityService(databaseWithTransaction(transaction));

  await service.listChildren({
    ...context(),
    actorSubjectId: 'caregiver-subject',
    role: 'CAREGIVER',
  });

  assert.deepEqual(query.where.caregivers, {
    some: { caregiver: { subjectId: 'caregiver-subject' } },
  });
});

test('does not apply caregiver relationship filtering to authorized workers', async () => {
  let query;
  const transaction = {
    async $executeRawUnsafe() {},
    child: { async findMany(input) { query = input; return []; } },
    auditEvent: { async create() {} },
  };
  const service = createIdentityService(databaseWithTransaction(transaction));

  await service.listChildren({ ...context(), role: 'HEALTH_WORKER' });

  assert.equal(query.where.caregivers, undefined);
});

test('loads the caregiver profile only through the authenticated subject', async () => {
  let query;
  const transaction = {
    async $executeRawUnsafe() {},
    caregiver: {
      async findFirst(input) { query = input; return { id: 'caregiver-1', children: [] }; },
    },
  };
  const service = createIdentityService(databaseWithTransaction(transaction));

  const result = await service.getMyCaregiverProfile({
    ...context(),
    actorSubjectId: 'caregiver-subject',
    role: 'CAREGIVER',
  });

  assert.equal(result.id, 'caregiver-1');
  assert.deepEqual(query.where, {
    organizationId: 'org-1',
    subjectId: 'caregiver-subject',
  });
  assert.equal(query.select.ussdPinHash, undefined);
});

test('refuses to link a caregiver not found in the same organization', async () => {
  const transaction = {
    async $executeRawUnsafe() {},
    child: { async findFirst() { return { id: 'child-1' }; } },
    caregiver: { async findFirst() { return null; } },
  };
  const service = createIdentityService(databaseWithTransaction(transaction));

  await assert.rejects(
    service.linkCaregiver(context(), 'child-1', {
      caregiverId: 'caregiver-other-tenant',
      relationship: 'GUARDIAN',
    }),
    (error) => error.code === 'IDENTITY_RECORD_NOT_FOUND' && error.status === 404
  );
});
