const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createOrganizationLifecycleService,
} = require('../services/organizationLifecycleService');
const {
  createOrganizationResourceLifecycleService,
} = require('../services/organizationResourceLifecycleService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'owner-1',
  purpose: 'organization-administration',
};

test('suspends an organization with audit evidence', async () => {
  let status;
  let audit;
  const tx = {
    async $executeRawUnsafe() {},
    organization: {
      async findUnique() {
        return { id: 'org-1', status: 'ACTIVE' };
      },
      async update({ data }) {
        status = data.status;
        return { id: 'org-1', status };
      },
    },
    auditEvent: {
      async create({ data }) {
        audit = data;
      },
    },
  };
  const result = await createOrganizationLifecycleService(
    databaseWithTransaction(tx)
  ).changeStatus(context, {
    status: 'SUSPENDED',
    reason: 'Incident containment',
  });

  assert.equal(result.status, 'SUSPENDED');
  assert.equal(audit.action, 'organization.suspended');
});

test('does not archive a facility with scheduled appointments', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    facility: {
      async findFirst() {
        return { id: 'facility-1', isActive: true };
      },
    },
    appointment: {
      async count() {
        return 2;
      },
    },
  };
  const service = createOrganizationResourceLifecycleService(
    databaseWithTransaction(tx)
  );

  await assert.rejects(
    service.updateFacility(context, 'facility-1', { isActive: false }),
    (error) => error.code === 'FACILITY_HAS_SCHEDULED_APPOINTMENTS'
  );
});
