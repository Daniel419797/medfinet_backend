const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const {
  calculateOrganizationMetrics,
  disclosureFor,
} = require('./analyticsMetrics');

const MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1000;

function normalizePeriod(input, now = new Date()) {
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (
    Number.isNaN(periodStart.valueOf())
    || Number.isNaN(periodEnd.valueOf())
    || periodEnd <= periodStart
    || periodEnd > now
    || periodEnd - periodStart > MAX_PERIOD_MS
  ) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'Reporting period must be valid, complete, and no longer than 366 days'
    );
  }
  return { periodStart, periodEnd };
}

function createAnalyticsGenerationService(
  prismaClient,
  {
    now = () => new Date(),
    calculateMetrics = calculateOrganizationMetrics,
  } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function request(context, input) {
    const idempotencyKey = requiredText(
      input.idempotencyKey,
      'idempotencyKey',
      160
    );
    const period = normalizePeriod(input, now());
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.analyticsGenerationRun.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: context.organizationId,
            idempotencyKey,
          },
        },
      });
      if (replay) return { run: replay, idempotentReplay: true };
      const run = await transaction.analyticsGenerationRun.create({
        data: {
          organizationId: context.organizationId,
          requestedBySubjectId: context.actorSubjectId,
          idempotencyKey,
          ...period,
        },
      });
      await Promise.all([
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'ANALYTICS_GENERATION_REQUESTED',
            aggregateType: 'analytics-generation-run',
            aggregateId: run.id,
            idempotencyKey: `analytics-generation:${run.id}`,
            payload: { analyticsGenerationRunId: run.id },
          },
        }),
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'analytics-generation.requested',
            entityType: 'analytics-generation-run',
            entityId: run.id,
            purpose: context.purpose,
            metadata: {
              periodStart: period.periodStart.toISOString(),
              periodEnd: period.periodEnd.toISOString(),
            },
          },
        }),
      ]);
      return { run, idempotentReplay: false };
    });
  }

  async function process(context, runId) {
    const startedAt = now();
    const claimed = await withTenantTransaction(
      database,
      context.organizationId,
      async (transaction) => {
        const result = await transaction.analyticsGenerationRun.updateMany({
          where: {
            id: runId,
            organizationId: context.organizationId,
            status: 'QUEUED',
          },
          data: { status: 'PROCESSING', startedAt, lastErrorCode: null },
        });
        if (result.count !== 1) {
          const existing = await transaction.analyticsGenerationRun.findFirst({
            where: { id: runId, organizationId: context.organizationId },
          });
          if (existing?.status === 'COMPLETED') return { completed: existing };
          throw new DomainError(
            409,
            'ANALYTICS_RUN_NOT_CLAIMABLE',
            'Analytics generation is already processing or unavailable'
          );
        }
        return {
          run: await transaction.analyticsGenerationRun.findUnique({
            where: { id: runId },
          }),
          policy: await transaction.analyticsPublicationPolicy.findUnique({
            where: { organizationId: context.organizationId },
          }),
        };
      }
    );
    if (claimed.completed) {
      return { run: claimed.completed, idempotentReplay: true };
    }

    try {
      return await withTenantTransaction(
        database,
        context.organizationId,
        async (transaction) => {
          const period = {
            periodStart: claimed.run.periodStart,
            periodEnd: claimed.run.periodEnd,
          };
          const metrics = await calculateMetrics(
            transaction,
            context.organizationId,
            period
          );
          const dataThrough = now();
          const snapshots = metrics.map((metric) => ({
            organizationId: context.organizationId,
            generationRunId: runId,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            dimensionType: 'ORGANIZATION',
            dimensionValue: context.organizationId,
            dataThrough,
            ...metric,
            ...disclosureFor(metric, claimed.policy),
          }));
          await transaction.aggregateMetricSnapshot.createMany({
            data: snapshots,
          });
          const run = await transaction.analyticsGenerationRun.update({
            where: { id: runId },
            data: {
              status: 'COMPLETED',
              completedAt: dataThrough,
              metricCount: snapshots.length,
            },
          });
          return { run, idempotentReplay: false };
        }
      );
    } catch (error) {
      await withTenantTransaction(database, context.organizationId, (transaction) => (
        transaction.analyticsGenerationRun.updateMany({
          where: {
            id: runId,
            organizationId: context.organizationId,
            status: 'PROCESSING',
          },
          data: {
            status: 'QUEUED',
            startedAt: null,
            lastErrorCode: error instanceof DomainError
              ? error.code
              : 'ANALYTICS_GENERATION_FAILED',
          },
        })
      ));
      throw error;
    }
  }

  return { request, process };
}

module.exports = {
  createAnalyticsGenerationService,
  normalizePeriod,
  MAX_PERIOD_MS,
};
