const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const GEOGRAPHY_LEVELS = new Set(['NATIONAL', 'STATE', 'LGA']);

function normalizePolicy(context, input) {
  const minimumCellSize = Number(input.minimumCellSize ?? 10);
  if (
    !Number.isInteger(minimumCellSize)
    || minimumCellSize < 10
    || minimumCellSize > 1000
  ) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'minimumCellSize must be between 10 and 1000'
    );
  }
  const maximumGeography = input.maximumGeography || 'STATE';
  if (!GEOGRAPHY_LEVELS.has(maximumGeography)) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'maximumGeography is invalid'
    );
  }
  const isPublicEnabled = input.isPublicEnabled === true;
  return {
    isPublicEnabled,
    minimumCellSize,
    maximumGeography,
    publicOrganizationName: isPublicEnabled
      ? requiredText(input.publicOrganizationName, 'publicOrganizationName', 160)
      : input.publicOrganizationName?.trim().slice(0, 160) || null,
    approvedBySubjectId: isPublicEnabled ? context.actorSubjectId : null,
    approvedAt: isPublicEnabled ? new Date() : null,
  };
}

function createAnalyticsPolicyService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function upsert(context, input) {
    const data = normalizePolicy(context, input);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const policy = await transaction.analyticsPublicationPolicy.upsert({
        where: { organizationId: context.organizationId },
        create: { organizationId: context.organizationId, ...data },
        update: data,
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'analytics-publication-policy.updated',
          entityType: 'analytics-publication-policy',
          entityId: policy.id,
          purpose: context.purpose,
          metadata: {
            isPublicEnabled: policy.isPublicEnabled,
            minimumCellSize: policy.minimumCellSize,
            maximumGeography: policy.maximumGeography,
          },
        },
      });
      return policy;
    });
  }

  async function get(context) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.analyticsPublicationPolicy.findUnique({
        where: { organizationId: context.organizationId },
      })
    ));
  }

  return { upsert, get };
}

module.exports = {
  createAnalyticsPolicyService,
  normalizePolicy,
  GEOGRAPHY_LEVELS,
};
