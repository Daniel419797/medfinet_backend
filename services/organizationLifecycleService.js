const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

function createOrganizationLifecycleService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function changeStatus(context, input) {
    if (!['ACTIVE', 'SUSPENDED'].includes(input.status)) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'Organization status must be ACTIVE or SUSPENDED'
      );
    }
    const reason = requiredText(input.reason, 'reason', 1000);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const organization = await transaction.organization.findUnique({
        where: { id: context.organizationId },
      });
      if (!organization || organization.status === 'ARCHIVED') {
        throw new DomainError(
          409,
          'ORGANIZATION_STATUS_IMMUTABLE',
          'An archived organization cannot change status'
        );
      }
      if (organization.status === input.status) return organization;
      const updated = await transaction.organization.update({
        where: { id: organization.id },
        data: { status: input.status },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: `organization.${input.status.toLowerCase()}`,
          entityType: 'organization',
          entityId: organization.id,
          purpose: context.purpose,
          metadata: { from: organization.status, to: input.status, reason },
        },
      });
      return updated;
    });
  }

  return { changeStatus };
}

module.exports = { createOrganizationLifecycleService };
