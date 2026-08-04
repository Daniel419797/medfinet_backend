const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const CATEGORIES = new Set([
  'AUDIT_EVIDENCE',
  'CLINICAL_RECORD',
  'IDENTITY_RECORD',
  'NOTIFICATION_ATTEMPT',
  'INTEGRATION_STAGING',
  'PUBLISHED_OUTBOX',
]);
const DELETABLE_CATEGORIES = new Set([
  'NOTIFICATION_ATTEMPT',
  'INTEGRATION_STAGING',
  'PUBLISHED_OUTBOX',
]);

function normalizePolicy(input) {
  if (!CATEGORIES.has(input.recordCategory)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'recordCategory is invalid');
  }
  const retentionDays = Number(input.retentionDays);
  if (
    !Number.isInteger(retentionDays)
    || retentionDays < 1
    || retentionDays > 36500
  ) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'retentionDays must be between 1 and 36500'
    );
  }
  const disposition = input.disposition || 'REVIEW_ONLY';
  if (!['REVIEW_ONLY', 'DELETE'].includes(disposition)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'disposition is invalid');
  }
  if (disposition === 'DELETE' && !DELETABLE_CATEGORIES.has(input.recordCategory)) {
    throw new DomainError(
      409,
      'UNSAFE_RETENTION_DISPOSITION',
      'This record category requires case-by-case review and cannot be auto-deleted'
    );
  }
  return {
    recordCategory: input.recordCategory,
    retentionDays,
    disposition,
    legalBasis: requiredText(input.legalBasis, 'legalBasis', 1000),
  };
}

function createRetentionPolicyService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function create(context, input) {
    const normalized = normalizePolicy(input);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const latest = await transaction.dataRetentionPolicy.findFirst({
        where: {
          organizationId: context.organizationId,
          recordCategory: normalized.recordCategory,
        },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const policy = await transaction.dataRetentionPolicy.create({
        data: {
          organizationId: context.organizationId,
          ...normalized,
          version: (latest?.version || 0) + 1,
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'retention-policy.created',
          entityType: 'data-retention-policy',
          entityId: policy.id,
          purpose: context.purpose,
          metadata: {
            recordCategory: policy.recordCategory,
            version: policy.version,
            disposition: policy.disposition,
          },
        },
      });
      return policy;
    });
  }

  async function activate(context, policyId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const policy = await transaction.dataRetentionPolicy.findFirst({
        where: {
          id: policyId,
          organizationId: context.organizationId,
          status: 'DRAFT',
        },
      });
      if (!policy) {
        throw new DomainError(
          404,
          'DRAFT_RETENTION_POLICY_NOT_FOUND',
          'Draft retention policy not found'
        );
      }
      if (policy.createdBySubjectId === context.actorSubjectId) {
        throw new DomainError(
          409,
          'RETENTION_POLICY_MAKER_CHECKER_REQUIRED',
          'A different administrator must activate this policy'
        );
      }
      const activatedAt = new Date();
      await transaction.dataRetentionPolicy.updateMany({
        where: {
          organizationId: context.organizationId,
          recordCategory: policy.recordCategory,
          status: 'ACTIVE',
        },
        data: { status: 'RETIRED' },
      });
      const activated = await transaction.dataRetentionPolicy.update({
        where: { id: policy.id },
        data: {
          status: 'ACTIVE',
          approvedBySubjectId: context.actorSubjectId,
          approvedAt: activatedAt,
          effectiveAt: activatedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'retention-policy.activated',
          entityType: 'data-retention-policy',
          entityId: policy.id,
          purpose: context.purpose,
          metadata: {
            recordCategory: policy.recordCategory,
            version: policy.version,
          },
        },
      });
      return activated;
    });
  }

  async function list(context) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.dataRetentionPolicy.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [
          { recordCategory: 'asc' },
          { version: 'desc' },
        ],
      })
    ));
  }

  return { create, activate, list };
}

module.exports = {
  createRetentionPolicyService,
  normalizePolicy,
  CATEGORIES,
  DELETABLE_CATEGORIES,
};
