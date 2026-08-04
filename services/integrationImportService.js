const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { createIntegrationCrypto } = require('./integrationCrypto');
const { payloadHash } = require('./integrationPayload');

const IMPORT_BATCH_SIZE = 100;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function externalRecordKey(resourceType, resource) {
  const identity = resource?.id
    || resource?.trackedEntity
    || resource?.event
    || payloadHash(resource);
  return `${resourceType}:${identity}`;
}

function createIntegrationImportService(
  prismaClient,
  {
    adapters,
    cryptoService,
    now = () => new Date(),
    lockTimeoutMs = LOCK_TIMEOUT_MS,
  } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const encryption = cryptoService || createIntegrationCrypto();

  async function claim(context, jobId) {
    const workerId = context.requestId || context.actorSubjectId;
    const currentTime = now();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await transaction.integrationJob.updateMany({
        where: {
          id: jobId,
          organizationId: context.organizationId,
          status: 'PROCESSING',
          lockedAt: {
            lt: new Date(currentTime.getTime() - lockTimeoutMs),
          },
        },
        data: { lockedAt: null, lockedBy: null },
      });
      const existing = await transaction.integrationJob.findFirst({
        where: {
          id: jobId,
          organizationId: context.organizationId,
          direction: 'IMPORT',
          status: { in: ['QUEUED', 'PROCESSING'] },
          lockedAt: null,
        },
      });
      if (!existing) {
        const completed = await transaction.integrationJob.findFirst({
          where: { id: jobId, organizationId: context.organizationId },
        });
        if (
          completed
          && ['COMPLETED', 'PARTIAL', 'CANCELLED'].includes(completed.status)
        ) {
          return { completed };
        }
        throw new DomainError(
          409,
          'INTEGRATION_JOB_NOT_CLAIMABLE',
          'Integration import is already claimed or not importable'
        );
      }
      const claimed = await transaction.integrationJob.updateMany({
        where: {
          id: existing.id,
          organizationId: context.organizationId,
          status: existing.status,
          lockedAt: null,
        },
        data: {
          status: 'PROCESSING',
          startedAt: existing.startedAt || currentTime,
          lockedAt: currentTime,
          lockedBy: workerId,
        },
      });
      if (claimed.count !== 1) {
        throw new DomainError(
          409,
          'INTEGRATION_JOB_CLAIM_CONFLICT',
          'Integration import was claimed by another worker'
        );
      }
      const job = await transaction.integrationJob.findUnique({
        where: { id: existing.id },
        include: { connection: true, mapping: true },
      });
      return { job, workerId };
    });
  }

  async function stage(context, job, resource) {
    const recordKey = externalRecordKey(job.resourceType, resource);
    const encrypted = encryption.encrypt(resource);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const staging = await transaction.integrationImportStaging.upsert({
        where: { jobId_recordKey: { jobId: job.id, recordKey } },
        create: {
          organizationId: context.organizationId,
          jobId: job.id,
          recordKey,
          externalResourceType: job.resourceType,
          externalResourceId: resource.id
            || resource.trackedEntity
            || resource.event
            || null,
          ...encrypted,
        },
        update: {},
      });
      await transaction.integrationExchangeRecord.upsert({
        where: { jobId_recordKey: { jobId: job.id, recordKey } },
        create: {
          organizationId: context.organizationId,
          jobId: job.id,
          recordKey,
          localResourceType: job.resourceType,
          externalResourceId: staging.externalResourceId,
          payloadHash: encrypted.payloadHash,
          status: 'STAGED',
        },
        update: {},
      });
      return staging;
    });
  }

  async function finish(context, job, workerId, count, nextCursor) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const hasMore = Boolean(nextCursor);
      const completedAt = now();
      const updated = await transaction.integrationJob.updateMany({
        where: {
          id: job.id,
          organizationId: context.organizationId,
          status: 'PROCESSING',
          lockedBy: workerId,
        },
        data: {
          cursor: nextCursor,
          recordsDiscovered: { increment: count },
          recordsSucceeded: { increment: count },
          ...(hasMore
            ? { lockedAt: null, lockedBy: null }
            : {
              status: 'COMPLETED',
              completedAt,
              lockedAt: null,
              lockedBy: null,
            }),
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'INTEGRATION_JOB_LOCK_LOST',
          'Integration import lock was lost'
        );
      }
      if (hasMore) {
        await transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'INTEGRATION_JOB_REQUESTED',
            aggregateType: 'integration-job',
            aggregateId: job.id,
            idempotencyKey: `integration-job:${job.id}:cursor:${nextCursor}`,
            payload: { integrationJobId: job.id },
          },
        });
      }
      return {
        status: hasMore ? 'PROCESSING' : 'COMPLETED',
        staged: count,
        hasMore,
      };
    });
  }

  async function processBatch(context, jobId) {
    const claimed = await claim(context, jobId);
    if (claimed.completed) {
      return { status: claimed.completed.status, idempotentReplay: true };
    }
    const { job, workerId } = claimed;
    try {
      const adapter = adapters?.[job.connection.type];
      if (!adapter) {
        throw new DomainError(
          503,
          'INTEGRATION_ADAPTER_UNAVAILABLE',
          'Integration adapter is unavailable'
        );
      }
      const page = await adapter.importPage(
        job.connection,
        job.resourceType,
        job.cursor
      );
      if (!Array.isArray(page.resources) || page.resources.length > IMPORT_BATCH_SIZE) {
        throw new DomainError(
          502,
          'INTEGRATION_IMPORT_PAGE_INVALID',
          'Partner import page exceeds the supported record count'
        );
      }
      for (const resource of page.resources) {
        await stage(context, job, resource);
      }
      return finish(
        context,
        job,
        workerId,
        page.resources.length,
        page.nextCursor
      );
    } catch (error) {
      await withTenantTransaction(database, context.organizationId, (transaction) => (
        transaction.integrationJob.updateMany({
          where: {
            id: job.id,
            organizationId: context.organizationId,
            lockedBy: workerId,
          },
          data: { lockedAt: null, lockedBy: null },
        })
      ));
      throw error;
    }
  }

  return { claim, processBatch, stage };
}

module.exports = {
  createIntegrationImportService,
  externalRecordKey,
  IMPORT_BATCH_SIZE,
};
