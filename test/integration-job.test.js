const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createIntegrationJobService,
} = require('../services/integrationJobService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'admin-1',
  purpose: 'integration-administration',
};

test('starts one authorized export job and queues it durably', async () => {
  const writes = { jobs: [], outbox: [], audits: [] };
  const tx = {
    async $executeRawUnsafe() {},
    integrationJob: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        const job = { id: 'job-1', ...data };
        writes.jobs.push(job);
        return job;
      },
    },
    integrationMapping: {
      async findFirst() {
        return {
          id: 'mapping-1',
          direction: 'EXPORT',
          resourceType: 'Immunization',
          connection: {
            status: 'ACTIVE',
            allowedDataCategories: ['IMMUNIZATION'],
          },
        };
      },
    },
    outboxEvent: {
      async create({ data }) {
        writes.outbox.push(data);
      },
    },
    auditEvent: {
      async create({ data }) {
        writes.audits.push(data);
      },
    },
  };

  const service = createIntegrationJobService(databaseWithTransaction(tx));
  const result = await service.start(context, 'connection-1', {
    mappingId: 'mapping-1',
    direction: 'EXPORT',
    criteria: { childIds: ['child-1', 'child-1', 'child-2'] },
    idempotencyKey: 'export-2026-07-29',
  });

  assert.equal(result.idempotentReplay, false);
  assert.deepEqual(writes.jobs[0].criteria, {
    childIds: ['child-1', 'child-2'],
  });
  assert.equal(writes.outbox[0].eventType, 'INTEGRATION_JOB_REQUESTED');
  assert.equal(writes.audits[0].action, 'integration-job.started');
});

test('returns an idempotent replay without creating work', async () => {
  let mappingRead = false;
  const replay = {
    id: 'job-existing',
    organizationId: 'org-1',
    idempotencyKey: 'same-key',
  };
  const tx = {
    async $executeRawUnsafe() {},
    integrationJob: {
      async findUnique() {
        return replay;
      },
    },
    integrationMapping: {
      async findFirst() {
        mappingRead = true;
      },
    },
  };

  const result = await createIntegrationJobService(
    databaseWithTransaction(tx)
  ).start(context, 'connection-1', {
    mappingId: 'mapping-1',
    direction: 'EXPORT',
    criteria: { childIds: ['child-1'] },
    idempotencyKey: 'same-key',
  });

  assert.equal(result.idempotentReplay, true);
  assert.equal(result.job, replay);
  assert.equal(mappingRead, false);
});

test('rejects a mapping whose data category is not authorized', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    integrationJob: {
      async findUnique() {
        return null;
      },
    },
    integrationMapping: {
      async findFirst() {
        return {
          id: 'mapping-1',
          direction: 'EXPORT',
          resourceType: 'Observation',
          connection: {
            status: 'ACTIVE',
            allowedDataCategories: ['IMMUNIZATION'],
          },
        };
      },
    },
  };

  await assert.rejects(
    createIntegrationJobService(databaseWithTransaction(tx)).start(
      context,
      'connection-1',
      {
        mappingId: 'mapping-1',
        direction: 'EXPORT',
        criteria: { childIds: ['child-1'] },
        idempotencyKey: 'unauthorized-category',
      }
    ),
    (error) => error.code === 'INTEGRATION_DATA_CATEGORY_NOT_ALLOWED'
  );
});
