const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const SUPPORTED_OPERATIONS = new Set([
  'APPOINTMENT.SCHEDULE',
  'CLIMATE.PROFILE_UPSERT',
  'CLINICAL.GROWTH_RECORD',
  'CLINICAL.IMMUNIZATION_RECORD',
  'RESPONSE.DELIVERY_RECORD',
  'RESPONSE.REFERRAL_CREATE',
]);
const MAX_OPERATION_BYTES = 64 * 1024;

function normalizeOperations(operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'operations must contain between 1 and 100 entries'
    );
  }
  const normalized = operations.map((operation) => {
    const clientOperationId = requiredText(
      operation?.clientOperationId,
      'clientOperationId',
      120
    );
    const operationType = requiredText(operation?.operationType, 'operationType', 100);
    if (!SUPPORTED_OPERATIONS.has(operationType)) {
      throw new DomainError(400, 'UNSUPPORTED_SYNC_OPERATION', `${operationType} is unsupported`);
    }
    if (!operation.payload || typeof operation.payload !== 'object' || Array.isArray(operation.payload)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'operation payload must be an object');
    }
    if (Buffer.byteLength(JSON.stringify(operation.payload), 'utf8') > MAX_OPERATION_BYTES) {
      throw new DomainError(413, 'SYNC_OPERATION_TOO_LARGE', 'An operation payload exceeds 64 KiB');
    }
    if (
      operation.baseVersion !== undefined
      && (!Number.isInteger(operation.baseVersion) || operation.baseVersion < 0)
    ) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'baseVersion must be a non-negative integer');
    }
    return {
      clientOperationId,
      operationType,
      payload: operation.payload,
      ...(operation.entityId
        ? { entityId: requiredText(operation.entityId, 'entityId', 120) }
        : {}),
      ...(operation.baseVersion !== undefined ? { baseVersion: operation.baseVersion } : {}),
    };
  });
  if (new Set(normalized.map(({ clientOperationId }) => clientOperationId)).size !== normalized.length) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'clientOperationId values must be unique');
  }
  return normalized;
}

function createSyncService(
  prismaClient,
  {
    handlers = {},
    now = () => new Date(),
    processingTimeoutMs = 5 * 60 * 1000,
  } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function submitBatch(context, deviceId, input) {
    const clientBatchId = requiredText(input.clientBatchId, 'clientBatchId', 120);
    const operations = normalizeOperations(input.operations);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const device = await transaction.fieldDevice.findFirst({
        where: {
          id: deviceId,
          organizationId: context.organizationId,
          subjectId: context.actorSubjectId,
          status: 'ACTIVE',
        },
      });
      if (!device) {
        throw new DomainError(
          403,
          'ACTIVE_DEVICE_REQUIRED',
          'An active device registered to this subject is required'
        );
      }
      const replay = await transaction.syncBatch.findUnique({
        where: { deviceId_clientBatchId: { deviceId, clientBatchId } },
        include: { operations: { orderBy: { createdAt: 'asc' } } },
      });
      if (replay) return { batch: replay, idempotentReplay: true };

      const batch = await transaction.syncBatch.create({
        data: {
          organizationId: context.organizationId,
          deviceId,
          clientBatchId,
          operationCount: operations.length,
          operations: {
            create: operations.map((operation) => ({
              organizationId: context.organizationId,
              deviceId,
              ...operation,
            })),
          },
        },
        include: { operations: { orderBy: { createdAt: 'asc' } } },
      });
      await Promise.all([
        transaction.fieldDevice.update({
          where: { id: device.id },
          data: { lastSeenAt: now(), appVersion: device.appVersion },
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'SYNC_BATCH_ACCEPTED',
            aggregateType: 'sync-batch',
            aggregateId: batch.id,
            idempotencyKey: `sync-batch:${batch.id}:accepted`,
            payload: { syncBatchId: batch.id },
          },
        }),
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'sync-batch.accepted',
            entityType: 'sync-batch',
            entityId: batch.id,
            purpose: context.purpose,
            metadata: {
              deviceId,
              operationCount: operations.length,
            },
          },
        }),
      ]);
      return { batch, idempotentReplay: false };
    });
  }

  async function processBatch(context, batchId) {
    const claimResult = await withTenantTransaction(
      database,
      context.organizationId,
      async (transaction) => {
        const currentTime = now();
        await transaction.syncBatch.updateMany({
          where: {
            id: batchId,
            organizationId: context.organizationId,
            status: 'PROCESSING',
            processingAt: {
              lt: new Date(currentTime.valueOf() - processingTimeoutMs),
            },
          },
          data: { status: 'PENDING', processingAt: null },
        });
        const claim = await transaction.syncBatch.updateMany({
          where: {
            id: batchId,
            organizationId: context.organizationId,
            status: 'PENDING',
          },
          data: { status: 'PROCESSING', processingAt: currentTime },
        });
        if (claim.count !== 1) {
          const batch = await transaction.syncBatch.findFirst({
            where: { id: batchId, organizationId: context.organizationId },
            include: { operations: true },
          });
          return { batch, claimed: false };
        }
        const batch = await transaction.syncBatch.findFirst({
          where: { id: batchId, organizationId: context.organizationId },
          include: { operations: { orderBy: { createdAt: 'asc' } } },
        });
        return { batch, claimed: true };
      }
    );
    const claimed = claimResult.batch;
    if (!claimed) throw new DomainError(404, 'SYNC_BATCH_NOT_FOUND', 'Sync batch not found');
    if (!claimResult.claimed) return claimed;

    for (const operation of claimed.operations.filter(({ status }) => status === 'PENDING')) {
      await processOperation(context, operation);
    }

    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const operations = await transaction.syncOperation.findMany({
        where: { syncBatchId: batchId, organizationId: context.organizationId },
        select: { status: true },
      });
      const statuses = new Set(operations.map(({ status }) => status));
      const status = statuses.size === 1 && statuses.has('APPLIED')
        ? 'COMPLETED'
        : statuses.has('APPLIED')
          ? 'PARTIAL'
          : 'FAILED';
      return transaction.syncBatch.update({
        where: { id: batchId },
        data: { status, completedAt: now() },
        include: { operations: { orderBy: { createdAt: 'asc' } } },
      });
    });
  }

  async function getBatch(context, batchId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const batch = await transaction.syncBatch.findFirst({
        where: {
          id: batchId,
          organizationId: context.organizationId,
          device: { subjectId: context.actorSubjectId },
        },
        include: { operations: { orderBy: { createdAt: 'asc' } } },
      });
      if (!batch) throw new DomainError(404, 'SYNC_BATCH_NOT_FOUND', 'Sync batch not found');
      return batch;
    });
  }

  async function listBatches(context, input = {}) {
    const limit = input.limit === undefined ? 50 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.syncBatch.findMany({
        where: {
          organizationId: context.organizationId,
          device: { subjectId: context.actorSubjectId },
          ...(input.status ? { status: input.status } : {}),
        },
        include: { operations: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    });
  }

  async function processOperation(context, operation) {
    const handler = handlers[operation.operationType];
    if (!handler) {
      return finalizeOperation(context, operation.id, {
        status: 'REJECTED',
        errorCode: 'SYNC_HANDLER_UNAVAILABLE',
        errorMessage: 'The operation handler is unavailable',
      });
    }
    await withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.syncOperation.update({
        where: { id: operation.id },
        data: { status: 'PROCESSING' },
      })
    ));
    try {
      const result = await handler(context, {
        ...operation.payload,
        entityId: operation.entityId,
        baseVersion: operation.baseVersion,
        sourceOperationId: operation.clientOperationId,
      });
      return finalizeOperation(context, operation.id, {
        status: 'APPLIED',
        result: JSON.parse(JSON.stringify(result)),
      });
    } catch (error) {
      const conflict = error?.status === 409;
      return finalizeOperation(context, operation.id, {
        status: conflict ? 'CONFLICT' : 'REJECTED',
        errorCode: error?.code || 'SYNC_OPERATION_FAILED',
        errorMessage: error instanceof DomainError
          ? error.message
          : 'The operation could not be applied',
      });
    }
  }

  async function finalizeOperation(context, operationId, outcome) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.syncOperation.update({
        where: { id: operationId },
        data: { ...outcome, processedAt: now() },
      })
    ));
  }

  return { submitBatch, processBatch, getBatch, listBatches };
}

module.exports = {
  createSyncService,
  normalizeOperations,
  SUPPORTED_OPERATIONS,
};
