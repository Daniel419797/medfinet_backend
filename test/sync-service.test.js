const assert = require('node:assert/strict');
const test = require('node:test');
const { DomainError } = require('../utils/domainError');
const { createSyncService, normalizeOperations } = require('../services/syncService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

function context() {
  return {
    organizationId: 'org-1',
    actorSubjectId: 'worker-1',
    role: 'HEALTH_WORKER',
    purpose: 'offline-sync',
  };
}

function transaction(overrides = {}) {
  return { async $executeRawUnsafe() {}, ...overrides };
}

test('rejects duplicate operation IDs and unsupported operation types', () => {
  assert.throws(
    () => normalizeOperations([
      {
        clientOperationId: 'op-1',
        operationType: 'UNKNOWN.OPERATION',
        payload: {},
      },
    ]),
    (error) => error.code === 'UNSUPPORTED_SYNC_OPERATION'
  );
  assert.throws(
    () => normalizeOperations([
      {
        clientOperationId: 'op-1',
        operationType: 'APPOINTMENT.SCHEDULE',
        payload: {},
      },
      {
        clientOperationId: 'op-1',
        operationType: 'CLINICAL.GROWTH_RECORD',
        payload: {},
      },
    ]),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('rejects offline immunization submission from a non-clinical role', async () => {
  let transactionStarted = false;
  const service = createSyncService({
    async $transaction() {
      transactionStarted = true;
    },
  });

  await assert.rejects(
    service.submitBatch(
      { ...context(), role: 'NUTRITION_WORKER' },
      'device-1',
      {
        clientBatchId: 'batch-client-1',
        operations: [{
          clientOperationId: 'operation-client-1',
          operationType: 'CLINICAL.IMMUNIZATION_RECORD',
          payload: {
            childId: 'child-1',
            vaccineCode: 'BCG',
            doseNumber: 1,
            administeredAt: '2026-07-28T10:00:00.000Z',
          },
        }],
      }
    ),
    (error) => error.code === 'SYNC_OPERATION_ROLE_DENIED' && error.status === 403
  );
  assert.equal(transactionStarted, false);
});

test('persists an accepted batch, operations, outbox event, and audit evidence', async () => {
  const calls = [];
  const tx = transaction({
    fieldDevice: {
      async findFirst() {
        return {
          id: 'device-1',
          subjectId: 'worker-1',
          status: 'ACTIVE',
          appVersion: '1.0.0',
        };
      },
      async update({ data }) {
        calls.push(['device', data]);
      },
    },
    syncBatch: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        calls.push(['batch', data]);
        return {
          id: 'batch-1',
          status: 'PENDING',
          ...data,
          operations: data.operations.create.map((operation, index) => ({
            id: `operation-${index + 1}`,
            status: 'PENDING',
            ...operation,
          })),
        };
      },
    },
    outboxEvent: {
      async create({ data }) {
        calls.push(['outbox', data]);
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createSyncService(databaseWithTransaction(tx));

  const result = await service.submitBatch(context(), 'device-1', {
    clientBatchId: 'batch-client-1',
    operations: [{
      clientOperationId: 'operation-client-1',
      operationType: 'CLINICAL.IMMUNIZATION_RECORD',
      payload: {
        childId: 'child-1',
        vaccineCode: 'BCG',
        doseNumber: 1,
        administeredAt: '2026-07-28T10:00:00.000Z',
      },
    }],
  });

  assert.equal(result.idempotentReplay, false);
  assert.equal(result.batch.operationCount, 1);
  assert.equal(calls[0][1].operations.create[0].deviceId, 'device-1');
  assert.equal(calls[2][1].eventType, 'SYNC_BATCH_ACCEPTED');
  assert.equal(calls[3][1].action, 'sync-batch.accepted');
});

test('processes operations sequentially and reports a partial batch on conflict', async () => {
  const operationState = new Map([
    ['operation-1', 'PENDING'],
    ['operation-2', 'PENDING'],
  ]);
  let batchStatus = 'PENDING';
  const operations = [
    {
      id: 'operation-1',
      status: 'PENDING',
      operationType: 'APPOINTMENT.SCHEDULE',
      payload: { childId: 'child-1' },
      clientOperationId: 'client-op-1',
      entityId: null,
      baseVersion: null,
    },
    {
      id: 'operation-2',
      status: 'PENDING',
      operationType: 'CLINICAL.GROWTH_RECORD',
      payload: { childId: 'child-1' },
      clientOperationId: 'client-op-2',
      entityId: null,
      baseVersion: 2,
    },
  ];
  let appliedContext;
  const tx = transaction({
    organizationMembership: {
      async findUnique() {
        return {
          id: 'membership-1',
          role: 'HEALTH_WORKER',
          scopeMode: 'GLOBAL',
          status: 'ACTIVE',
        };
      },
    },
    syncBatch: {
      async updateMany({ where, data }) {
        if (where.status === 'PROCESSING') return { count: 0 };
        if (where.status === 'PENDING' && batchStatus === 'PENDING') {
          batchStatus = data.status;
          return { count: 1 };
        }
        return { count: 0 };
      },
      async findFirst() {
        return {
          id: 'batch-1',
          status: batchStatus,
          device: {
            id: 'device-1',
            subjectId: 'field-worker-1',
            status: 'ACTIVE',
          },
          operations,
        };
      },
      async update({ data }) {
        batchStatus = data.status;
        return {
          id: 'batch-1',
          status: batchStatus,
          operations: operations.map((operation) => ({
            ...operation,
            status: operationState.get(operation.id),
          })),
        };
      },
    },
    syncOperation: {
      async update({ where, data }) {
        operationState.set(where.id, data.status);
        return { id: where.id, ...data };
      },
      async findMany() {
        return [...operationState.values()].map((status) => ({ status }));
      },
    },
  });
  const service = createSyncService(databaseWithTransaction(tx), {
    handlers: {
      'APPOINTMENT.SCHEDULE': async (handlerContext) => {
        appliedContext = handlerContext;
        return { id: 'appointment-1' };
      },
      'CLINICAL.GROWTH_RECORD': async () => {
        throw new DomainError(409, 'VERSION_CONFLICT', 'Record changed on the server');
      },
    },
    now: () => new Date('2026-07-29T01:00:00.000Z'),
  });

  const result = await service.processBatch({
    ...context(),
    actorSubjectId: 'system:outbox-worker',
    role: 'ADMIN',
    purpose: 'background-processing',
  }, 'batch-1');

  assert.equal(operationState.get('operation-1'), 'APPLIED');
  assert.equal(operationState.get('operation-2'), 'CONFLICT');
  assert.equal(result.status, 'PARTIAL');
  assert.equal(appliedContext.actorSubjectId, 'field-worker-1');
  assert.equal(appliedContext.role, 'HEALTH_WORKER');
  assert.equal(appliedContext.purpose, 'offline-sync');
});

test('does not process a batch claimed by another worker', async () => {
  let handlerCalled = false;
  const tx = transaction({
    syncBatch: {
      async updateMany() {
        return { count: 0 };
      },
      async findFirst() {
        return {
          id: 'batch-1',
          status: 'PROCESSING',
          operations: [{ id: 'operation-1', status: 'PENDING' }],
        };
      },
    },
  });
  const service = createSyncService(databaseWithTransaction(tx), {
    handlers: {
      'APPOINTMENT.SCHEDULE': async () => {
        handlerCalled = true;
      },
    },
  });

  const result = await service.processBatch(context(), 'batch-1');

  assert.equal(result.status, 'PROCESSING');
  assert.equal(handlerCalled, false);
});

test('lists only the current subject tenant sync batches with bounded pagination', async () => {
  let query;
  const tx = transaction({
    syncBatch: {
      async findMany(input) {
        query = input;
        return [
          { id: 'batch-2', status: 'COMPLETED', operations: [] },
          { id: 'batch-1', status: 'FAILED', operations: [] },
        ];
      },
    },
  });
  const service = createSyncService(databaseWithTransaction(tx));

  const page = await service.listBatches(context(), { limit: 1, status: 'COMPLETED' });

  assert.deepEqual(query.where, {
    organizationId: 'org-1',
    device: { subjectId: 'worker-1' },
    status: 'COMPLETED',
  });
  assert.equal(query.take, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, 'batch-2');
});
