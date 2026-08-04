const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createIntegrationQueryService,
  pagination,
} = require('../services/integrationQueryService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('lists only tenant connections without selecting credential references', async () => {
  let query;
  const tx = {
    async $executeRawUnsafe() {},
    integrationConnection: {
      async findMany(input) {
        query = input;
        return [
          { id: 'connection-2', name: 'FHIR Two' },
          { id: 'connection-1', name: 'FHIR One' },
        ];
      },
    },
  };
  const service = createIntegrationQueryService(databaseWithTransaction(tx));

  const page = await service.listConnections(
    { organizationId: 'org-1' },
    { limit: 1, type: 'FHIR_R4' }
  );

  assert.deepEqual(query.where, {
    organizationId: 'org-1',
    type: 'FHIR_R4',
  });
  assert.equal(query.select.credentialSecretName, undefined);
  assert.equal(query.select.authType, true);
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, 'connection-2');
});

test('rejects unbounded integration query pages', () => {
  assert.throws(
    () => pagination({ limit: 101 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('lists tenant jobs with resumable operational status', async () => {
  let query;
  const tx = {
    async $executeRawUnsafe() {},
    integrationJob: {
      async findMany(input) {
        query = input;
        return [{ id: 'job-1', connectionId: 'connection-1', status: 'QUEUED' }];
      },
    },
  };
  const service = createIntegrationQueryService(databaseWithTransaction(tx));

  const page = await service.listJobs(
    { organizationId: 'org-1' },
    { connectionId: 'connection-1', status: 'QUEUED' }
  );

  assert.deepEqual(query.where, {
    organizationId: 'org-1',
    connectionId: 'connection-1',
    status: 'QUEUED',
  });
  assert.equal(query.select.idempotencyKey, undefined);
  assert.equal(page.items[0].id, 'job-1');
});

test('lists tenant reconciliation evidence with connection and job summaries', async () => {
  let query;
  const tx = {
    async $executeRawUnsafe() {},
    integrationReconciliationRun: {
      async findMany(input) {
        query = input;
        return [{ id: 'reconciliation-1', status: 'COMPLETED' }];
      },
    },
  };
  const service = createIntegrationQueryService(databaseWithTransaction(tx));

  const page = await service.listReconciliations(
    { organizationId: 'org-1' },
    { status: 'COMPLETED' }
  );

  assert.deepEqual(query.where, {
    organizationId: 'org-1',
    status: 'COMPLETED',
  });
  assert.equal(query.include.connection.select.name, true);
  assert.equal(query.include.job.select.resourceType, true);
  assert.equal(page.items[0].id, 'reconciliation-1');
});
