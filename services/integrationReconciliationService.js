const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

const RECONCILIATION_BATCH_SIZE = 50;
const RECONCILIATION_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function createIntegrationReconciliationService(
  prismaClient,
  {
    adapters,
    now = () => new Date(),
    batchSize = RECONCILIATION_BATCH_SIZE,
    lockTimeoutMs = RECONCILIATION_LOCK_TIMEOUT_MS,
  } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function start(context, connectionId, input = {}) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const connection = await transaction.integrationConnection.findFirst({
        where: {
          id: connectionId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      if (!connection) {
        throw new DomainError(404, 'ACTIVE_INTEGRATION_NOT_FOUND', 'Active connection not found');
      }
      let jobId = null;
      if (input.jobId) {
        const job = await transaction.integrationJob.findFirst({
          where: {
            id: input.jobId,
            organizationId: context.organizationId,
            connectionId,
            direction: 'EXPORT',
            status: { in: ['COMPLETED', 'PARTIAL'] },
          },
        });
        if (!job) {
          throw new DomainError(
            404,
            'RECONCILABLE_INTEGRATION_JOB_NOT_FOUND',
            'Completed export job not found'
          );
        }
        jobId = job.id;
      } else {
        throw new DomainError(
          400,
          'VALIDATION_ERROR',
          'jobId is required for bounded reconciliation'
        );
      }
      const run = await transaction.integrationReconciliationRun.create({
        data: {
          organizationId: context.organizationId,
          connectionId,
          jobId,
          startedBySubjectId: context.actorSubjectId,
        },
      });
      await Promise.all([
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'INTEGRATION_RECONCILIATION_REQUESTED',
            aggregateType: 'integration-reconciliation',
            aggregateId: run.id,
            idempotencyKey: `integration-reconciliation:${run.id}:start`,
            payload: { reconciliationRunId: run.id },
          },
        }),
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'integration-reconciliation.started',
            entityType: 'integration-reconciliation',
            entityId: run.id,
            purpose: context.purpose,
            metadata: { connectionId, jobId },
          },
        }),
      ]);
      return run;
    });
  }

  async function claim(context, runId) {
    const workerId = context.requestId || context.actorSubjectId;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const currentTime = now();
      await transaction.integrationReconciliationRun.updateMany({
        where: {
          id: runId,
          organizationId: context.organizationId,
          status: 'RUNNING',
          lockedAt: {
            lt: new Date(currentTime.getTime() - lockTimeoutMs),
          },
        },
        data: { lockedAt: null, lockedBy: null },
      });
      const run = await transaction.integrationReconciliationRun.findFirst({
        where: {
          id: runId,
          organizationId: context.organizationId,
          status: 'RUNNING',
          lockedAt: null,
        },
        include: {
          connection: true,
          job: true,
        },
      });
      if (!run) {
        const completed = await transaction.integrationReconciliationRun.findFirst({
          where: { id: runId, organizationId: context.organizationId },
        });
        if (completed?.status === 'COMPLETED') return { completed };
        throw new DomainError(
          409,
          'RECONCILIATION_NOT_CLAIMABLE',
          'Reconciliation is already claimed or not running'
        );
      }
      const claimed = await transaction.integrationReconciliationRun.updateMany({
        where: {
          id: run.id,
          organizationId: context.organizationId,
          status: 'RUNNING',
          lockedAt: null,
        },
        data: { lockedAt: currentTime, lockedBy: workerId },
      });
      if (claimed.count !== 1) {
        throw new DomainError(
          409,
          'RECONCILIATION_CLAIM_CONFLICT',
          'Reconciliation was claimed by another worker'
        );
      }
      return { run, workerId };
    });
  }

  async function processBatch(context, runId) {
    const claimed = await claim(context, runId);
    if (claimed.completed) {
      return { status: 'COMPLETED', idempotentReplay: true };
    }
    const { run, workerId } = claimed;
    try {
      const records = await withTenantTransaction(
        database,
        context.organizationId,
        (transaction) => transaction.integrationExchangeRecord.findMany({
          where: {
            organizationId: context.organizationId,
            jobId: run.jobId,
            status: 'SUCCEEDED',
            ...(run.cursor ? { id: { gt: run.cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: batchSize,
        })
      );
      const adapter = adapters?.[run.connection.type];
      if (!adapter?.fetchResource) {
        throw new DomainError(
          503,
          'RECONCILIATION_ADAPTER_UNAVAILABLE',
          'Integration reconciliation adapter is unavailable'
        );
      }
      let externalCount = 0;
      let matchedCount = 0;
      let missingExternalCount = 0;
      let mismatchCount = 0;
      for (const record of records) {
        if (!record.externalResourceId) {
          missingExternalCount += 1;
          continue;
        }
        const remote = await adapter.fetchResource(
          run.connection,
          run.job.resourceType,
          record.externalResourceId
        );
        if (!remote.exists) {
          missingExternalCount += 1;
        } else {
          externalCount += 1;
          const versionMatches = (
            !record.externalVersion
            || !remote.externalVersion
            || record.externalVersion === remote.externalVersion
          );
          if (versionMatches) matchedCount += 1;
          else mismatchCount += 1;
        }
      }
      return withTenantTransaction(database, context.organizationId, async (transaction) => {
        const hasMore = records.length === batchSize;
        const cursor = records.at(-1)?.id || run.cursor;
        const updated = await transaction.integrationReconciliationRun.updateMany({
          where: {
            id: run.id,
            organizationId: context.organizationId,
            status: 'RUNNING',
            lockedBy: workerId,
          },
          data: {
            cursor,
            localCount: { increment: records.length },
            externalCount: { increment: externalCount },
            matchedCount: { increment: matchedCount },
            missingExternalCount: { increment: missingExternalCount },
            mismatchCount: { increment: mismatchCount },
            ...(hasMore
              ? { lockedAt: null, lockedBy: null }
              : {
                status: 'COMPLETED',
                completedAt: now(),
                lockedAt: null,
                lockedBy: null,
              }),
          },
        });
        if (updated.count !== 1) {
          throw new DomainError(
            409,
            'RECONCILIATION_LOCK_LOST',
            'Reconciliation lock was lost'
          );
        }
        if (hasMore) {
          await transaction.outboxEvent.create({
            data: {
              organizationId: context.organizationId,
              eventType: 'INTEGRATION_RECONCILIATION_REQUESTED',
              aggregateType: 'integration-reconciliation',
              aggregateId: run.id,
              idempotencyKey: `integration-reconciliation:${run.id}:cursor:${cursor}`,
              payload: { reconciliationRunId: run.id },
            },
          });
        }
        return {
          status: hasMore ? 'RUNNING' : 'COMPLETED',
          processed: records.length,
          hasMore,
        };
      });
    } catch (error) {
      await withTenantTransaction(database, context.organizationId, (transaction) => (
        transaction.integrationReconciliationRun.updateMany({
          where: {
            id: run.id,
            organizationId: context.organizationId,
            lockedBy: workerId,
          },
          data: { lockedAt: null, lockedBy: null },
        })
      ));
      throw error;
    }
  }

  return { start, processBatch };
}

module.exports = {
  createIntegrationReconciliationService,
  RECONCILIATION_BATCH_SIZE,
  RECONCILIATION_LOCK_TIMEOUT_MS,
};
