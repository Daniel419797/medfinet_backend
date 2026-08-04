const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertResourceScope,
  createResourceScopeService,
} = require('../services/resourceScopeService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('denies a scoped worker outside the assigned facility', async () => {
  const transaction = {
    membershipFacilityScope: {
      async findFirst() {
        return null;
      },
    },
  };

  await assert.rejects(
    assertResourceScope(transaction, {
      organizationId: 'org-1',
      membershipId: 'membership-1',
      scopeMode: 'SCOPED',
      role: 'HEALTH_WORKER',
    }, {
      facilityId: 'facility-outside-scope',
    }),
    (error) => error.code === 'RESOURCE_SCOPE_ACCESS_DENIED'
  );
});

test('atomically replaces verified facility and programme scopes', async () => {
  const writes = { facilities: [], programmes: [] };
  const tx = {
    async $executeRawUnsafe() {},
    organizationMembership: {
      async findFirst() {
        return {
          id: 'membership-1',
          role: 'HEALTH_WORKER',
          scopeMode: 'SCOPED',
          status: 'ACTIVE',
        };
      },
    },
    facility: { async count() { return 1; } },
    programme: { async count() { return 1; } },
    membershipFacilityScope: {
      async deleteMany() {},
      async createMany({ data }) {
        writes.facilities.push(...data);
      },
    },
    membershipProgrammeScope: {
      async deleteMany() {},
      async createMany({ data }) {
        writes.programmes.push(...data);
      },
    },
    auditEvent: { async create() {} },
  };

  const result = await createResourceScopeService(
    databaseWithTransaction(tx)
  ).replace({
    organizationId: 'org-1',
    actorSubjectId: 'admin-1',
    purpose: 'workforce-administration',
  }, 'membership-1', {
    facilityIds: ['facility-1'],
    programmeIds: ['programme-1'],
  });

  assert.equal(writes.facilities[0].organizationId, 'org-1');
  assert.equal(writes.programmes[0].organizationId, 'org-1');
  assert.deepEqual(result.facilityIds, ['facility-1']);
});
