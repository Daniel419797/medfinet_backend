const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { METRIC_CATALOG } = require('./analyticsMetrics');

function shapeMetric(snapshot) {
  return {
    key: snapshot.metricKey,
    ...METRIC_CATALOG[snapshot.metricKey],
    numerator: snapshot.numerator,
    denominator: snapshot.denominator,
    valueBasisPoints: snapshot.valueBasisPoints,
    cohortSize: snapshot.cohortSize,
    disclosureStatus: snapshot.disclosureStatus,
    suppressionReason: snapshot.suppressionReason,
  };
}

function createAnalyticsQueryService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function latestInternal(context) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const run = await transaction.analyticsGenerationRun.findFirst({
        where: {
          organizationId: context.organizationId,
          status: 'COMPLETED',
        },
        orderBy: [{ periodEnd: 'desc' }, { completedAt: 'desc' }],
      });
      if (!run) return { run: null, metrics: [] };
      const snapshots = await transaction.aggregateMetricSnapshot.findMany({
        where: {
          organizationId: context.organizationId,
          generationRunId: run.id,
        },
        orderBy: { metricKey: 'asc' },
      });
      return { run, metrics: snapshots.map(shapeMetric) };
    });
  }

  async function publicMetrics(organizationSlug) {
    const organization = await database.organization.findUnique({
      where: { slug: organizationSlug },
      select: { id: true, status: true },
    });
    if (!organization || organization.status !== 'ACTIVE') {
      throw new DomainError(
        404,
        'PUBLIC_METRICS_NOT_FOUND',
        'Public metrics are not available'
      );
    }
    return withTenantTransaction(database, organization.id, async (transaction) => {
      const policy = await transaction.analyticsPublicationPolicy.findUnique({
        where: { organizationId: organization.id },
      });
      if (!policy?.isPublicEnabled) {
        throw new DomainError(
          404,
          'PUBLIC_METRICS_NOT_FOUND',
          'Public metrics are not available'
        );
      }
      const run = await transaction.analyticsGenerationRun.findFirst({
        where: {
          organizationId: organization.id,
          status: 'COMPLETED',
          snapshots: { some: { disclosureStatus: 'PUBLISHED' } },
        },
        orderBy: [{ periodEnd: 'desc' }, { completedAt: 'desc' }],
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          completedAt: true,
        },
      });
      if (!run) {
        return {
          organization: policy.publicOrganizationName,
          period: null,
          dataThrough: null,
          metrics: [],
        };
      }
      const snapshots = await transaction.aggregateMetricSnapshot.findMany({
        where: {
          organizationId: organization.id,
          generationRunId: run.id,
          disclosureStatus: 'PUBLISHED',
          dimensionType: 'ORGANIZATION',
        },
        select: {
          metricKey: true,
          numerator: true,
          denominator: true,
          valueBasisPoints: true,
          cohortSize: true,
          disclosureStatus: true,
          suppressionReason: true,
          dataThrough: true,
        },
        orderBy: { metricKey: 'asc' },
      });
      return {
        organization: policy.publicOrganizationName,
        period: {
          start: run.periodStart,
          end: run.periodEnd,
        },
        dataThrough: snapshots[0]?.dataThrough || run.completedAt,
        metrics: snapshots.map(shapeMetric),
      };
    });
  }

  return { latestInternal, publicMetrics };
}

module.exports = {
  createAnalyticsQueryService,
  shapeMetric,
};
