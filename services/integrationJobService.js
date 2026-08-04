const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const RESOURCE_CATEGORIES = {
  Patient: ['IDENTITY', 'DEMOGRAPHICS'],
  Immunization: ['IMMUNIZATION'],
  Observation: ['NUTRITION'],
  Appointment: ['APPOINTMENTS'],
  TRACKED_ENTITY: ['IDENTITY', 'DEMOGRAPHICS'],
  EVENT: ['IMMUNIZATION'],
  DATA_VALUE_SET: ['SERVICE_DELIVERY'],
};

function normalizeCriteria(direction, input = {}) {
  if (direction === 'EXPORT') {
    if (
      !Array.isArray(input.childIds)
      || input.childIds.length < 1
      || input.childIds.length > 500
    ) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'Export criteria must contain between 1 and 500 childIds'
      );
    }
    const childIds = [...new Set(input.childIds.map((id) => (
      requiredText(id, 'childId', 100)
    )))];
    return { childIds };
  }
  if (input.since) {
    const since = new Date(input.since);
    if (Number.isNaN(since.valueOf()) || since > new Date()) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'since must be a past timestamp');
    }
    return { since: since.toISOString() };
  }
  return {};
}

function createIntegrationJobService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function start(context, connectionId, input) {
    const idempotencyKey = requiredText(
      input.idempotencyKey,
      'idempotencyKey',
      160
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.integrationJob.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: context.organizationId,
            idempotencyKey,
          },
        },
      });
      if (replay) return { job: replay, idempotentReplay: true };
      const mapping = await transaction.integrationMapping.findFirst({
        where: {
          id: input.mappingId,
          organizationId: context.organizationId,
          connectionId,
          status: 'ACTIVE',
          connection: { status: 'ACTIVE' },
        },
        include: { connection: true },
      });
      if (!mapping) {
        throw new DomainError(
          404,
          'ACTIVE_INTEGRATION_MAPPING_NOT_FOUND',
          'Active mapping on an active connection not found'
        );
      }
      if (mapping.direction !== input.direction) {
        throw new DomainError(
          409,
          'INTEGRATION_DIRECTION_MISMATCH',
          'Job direction does not match the mapping'
        );
      }
      const requiredCategories = RESOURCE_CATEGORIES[mapping.resourceType] || [];
      if (
        !Array.isArray(mapping.connection.allowedDataCategories)
        || requiredCategories.some((category) => (
          !mapping.connection.allowedDataCategories.includes(category)
        ))
      ) {
        throw new DomainError(
          409,
          'INTEGRATION_DATA_CATEGORY_NOT_ALLOWED',
          'Connection is not authorized for this resource category'
        );
      }
      const job = await transaction.integrationJob.create({
        data: {
          organizationId: context.organizationId,
          connectionId,
          mappingId: mapping.id,
          direction: mapping.direction,
          resourceType: mapping.resourceType,
          criteria: normalizeCriteria(mapping.direction, input.criteria),
          idempotencyKey,
          requestedBySubjectId: context.actorSubjectId,
        },
      });
      await Promise.all([
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'INTEGRATION_JOB_REQUESTED',
            aggregateType: 'integration-job',
            aggregateId: job.id,
            idempotencyKey: `integration-job:${job.id}:start`,
            payload: { integrationJobId: job.id },
          },
        }),
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'integration-job.started',
            entityType: 'integration-job',
            entityId: job.id,
            purpose: context.purpose,
            metadata: {
              connectionId,
              direction: job.direction,
              resourceType: job.resourceType,
            },
          },
        }),
      ]);
      return { job, idempotentReplay: false };
    });
  }

  async function get(context, jobId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const job = await transaction.integrationJob.findFirst({
        where: { id: jobId, organizationId: context.organizationId },
        include: {
          connection: { select: { id: true, name: true, type: true } },
          mapping: { select: { id: true, version: true } },
          reconciliations: {
            orderBy: { startedAt: 'desc' },
            take: 1,
          },
        },
      });
      if (!job) {
        throw new DomainError(404, 'INTEGRATION_JOB_NOT_FOUND', 'Integration job not found');
      }
      return job;
    });
  }

  async function cancel(context, jobId, input) {
    const reason = requiredText(input.reason, 'reason', 500);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const cancelledAt = new Date();
      const updated = await transaction.integrationJob.updateMany({
        where: {
          id: jobId,
          organizationId: context.organizationId,
          status: { in: ['QUEUED', 'PROCESSING'] },
        },
        data: {
          status: 'CANCELLED',
          startedAt: cancelledAt,
          completedAt: cancelledAt,
          lastErrorCode: 'CANCELLED_BY_ADMINISTRATOR',
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'INTEGRATION_JOB_NOT_CANCELLABLE',
          'Integration job is not cancellable'
        );
      }
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'integration-job.cancelled',
          entityType: 'integration-job',
          entityId: jobId,
          purpose: context.purpose,
          metadata: { reason },
        },
      });
      return transaction.integrationJob.findUnique({ where: { id: jobId } });
    });
  }

  return { start, get, cancel };
}

module.exports = {
  createIntegrationJobService,
  normalizeCriteria,
  RESOURCE_CATEGORIES,
};
