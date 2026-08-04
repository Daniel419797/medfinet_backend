const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { createConsentService } = require('./consentService');
const { loadExportRecords, RESOURCE_SCOPES } = require('./integrationExportMapper');
const { payloadHash } = require('./integrationPayload');

const BATCH_SIZE = 25;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function safeErrorCode(error) {
  return error instanceof DomainError
    ? error.code
    : 'INTEGRATION_RECORD_FAILED';
}

function createIntegrationExportService(
  prismaClient,
  {
    adapters,
    consentService,
    now = () => new Date(),
    batchSize = BATCH_SIZE,
    lockTimeoutMs = LOCK_TIMEOUT_MS,
  } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const consent = consentService || createConsentService(database);

  async function claim(context, jobId) {
    const workerId = context.requestId || context.actorSubjectId;
    const currentTime = now();
    const staleBefore = new Date(currentTime.getTime() - lockTimeoutMs);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await transaction.integrationJob.updateMany({
        where: {
          id: jobId,
          organizationId: context.organizationId,
          status: 'PROCESSING',
          lockedAt: { lt: staleBefore },
        },
        data: { lockedAt: null, lockedBy: null },
      });
      const existing = await transaction.integrationJob.findFirst({
        where: {
          id: jobId,
          organizationId: context.organizationId,
          direction: 'EXPORT',
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
          'Integration job is already claimed or not exportable'
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
          'Integration job was claimed by another worker'
        );
      }
      const job = await transaction.integrationJob.findUnique({
        where: { id: existing.id },
        include: { connection: true, mapping: true },
      });
      return { job, workerId };
    });
  }

  async function existingRecord(context, jobId, recordKey) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.integrationExchangeRecord.findUnique({
        where: { jobId_recordKey: { jobId, recordKey } },
      })
    ));
  }

  async function processRecord(context, job, record) {
    const replay = await existingRecord(context, job.id, record.recordKey);
    if (replay) return replay;
    const disclosure = await consent.evaluateDisclosure(context, record.childId, {
      recipientType: 'PARTNER',
      recipientId: job.connection.partnerIdentifier,
      purpose: 'INTEROPERABILITY_EXPORT',
      scopes: RESOURCE_SCOPES[job.resourceType],
      requestId: context.requestId,
    });
    if (!disclosure.allowed) {
      return {
        organizationId: context.organizationId,
        jobId: job.id,
        recordKey: record.recordKey,
        localResourceType: record.localResourceType,
        localResourceId: record.localResourceId,
        payloadHash: payloadHash({
          recordKey: record.recordKey,
          disclosureEventId: disclosure.disclosureEventId,
        }),
        status: 'SKIPPED',
        errorCode: 'CONSENT_DENIED',
      };
    }
    const adapter = adapters?.[job.connection.type];
    if (!adapter) {
      throw new DomainError(
        503,
        'INTEGRATION_ADAPTER_UNAVAILABLE',
        'Integration adapter is unavailable'
      );
    }
    const idempotencyKey = `integration:${job.id}:${record.recordKey}`;
    const result = job.connection.type === 'FHIR_R4'
      ? await adapter.exportResource(job.connection, record.payload)
      : await adapter.exportResource(
        job.connection,
        job.resourceType,
        record.payload,
        idempotencyKey
      );
    return {
      organizationId: context.organizationId,
      jobId: job.id,
      recordKey: record.recordKey,
      localResourceType: record.localResourceType,
      localResourceId: record.localResourceId,
      externalResourceId: result.externalId,
      externalVersion: result.externalVersion,
      payloadHash: payloadHash(record.payload),
      status: 'SUCCEEDED',
    };
  }

  async function persistRecord(context, data) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.integrationExchangeRecord.upsert({
        where: {
          jobId_recordKey: { jobId: data.jobId, recordKey: data.recordKey },
        },
        create: data,
        update: {},
      })
    ));
  }

  async function finishBatch(context, job, workerId, records, outcomes) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const lastCursor = records.at(-1)?.cursor || job.cursor;
      const succeeded = outcomes.filter(({ status }) => status === 'SUCCEEDED').length;
      const failed = outcomes.filter(({ status }) => status !== 'SUCCEEDED').length;
      const hasMore = records.length === batchSize;
      const finalStatus = failed + job.recordsFailed > 0 ? 'PARTIAL' : 'COMPLETED';
      const currentTime = now();
      const updated = await transaction.integrationJob.updateMany({
        where: {
          id: job.id,
          organizationId: context.organizationId,
          status: 'PROCESSING',
          lockedBy: workerId,
        },
        data: {
          cursor: lastCursor,
          recordsDiscovered: { increment: records.length },
          recordsSucceeded: { increment: succeeded },
          recordsFailed: { increment: failed },
          ...(hasMore
            ? { lockedAt: null, lockedBy: null }
            : {
              status: finalStatus,
              completedAt: currentTime,
              lockedAt: null,
              lockedBy: null,
            }),
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'INTEGRATION_JOB_LOCK_LOST',
          'Integration job lock was lost'
        );
      }
      if (hasMore) {
        await transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'INTEGRATION_JOB_REQUESTED',
            aggregateType: 'integration-job',
            aggregateId: job.id,
            idempotencyKey: `integration-job:${job.id}:cursor:${lastCursor}`,
            payload: { integrationJobId: job.id },
          },
        });
      }
      return {
        status: hasMore ? 'PROCESSING' : finalStatus,
        processed: records.length,
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
      const records = await withTenantTransaction(
        database,
        context.organizationId,
        (transaction) => loadExportRecords(transaction, job, batchSize)
      );
      const outcomes = [];
      for (const record of records) {
        let data;
        try {
          data = await processRecord(context, job, record);
        } catch (error) {
          data = {
            organizationId: context.organizationId,
            jobId: job.id,
            recordKey: record.recordKey,
            localResourceType: record.localResourceType,
            localResourceId: record.localResourceId,
            payloadHash: payloadHash(record.payload),
            status: 'FAILED',
            errorCode: safeErrorCode(error),
          };
        }
        outcomes.push(await persistRecord(context, data));
      }
      return finishBatch(context, job, workerId, records, outcomes);
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

  return { claim, processBatch };
}

module.exports = {
  createIntegrationExportService,
  safeErrorCode,
  BATCH_SIZE,
  LOCK_TIMEOUT_MS,
};
