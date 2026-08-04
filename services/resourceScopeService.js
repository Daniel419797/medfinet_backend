const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

function normalizeIds(values, field) {
  if (!Array.isArray(values) || values.length > 100) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `${field} must be an array with at most 100 identifiers`
    );
  }
  const ids = values.map((value) => requiredText(value, field, 100));
  if (new Set(ids).size !== ids.length) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} must be unique`);
  }
  return ids;
}

async function assertResourceScope(transaction, context, resources) {
  if (
    !context.membershipId
    || context.scopeMode !== 'SCOPED'
    || ['OWNER', 'ADMIN'].includes(context.role || context.actorRole)
  ) {
    return;
  }
  const checks = [];
  if (resources.facilityId) {
    checks.push(transaction.membershipFacilityScope.findFirst({
      where: {
        organizationId: context.organizationId,
        membershipId: context.membershipId,
        facilityId: resources.facilityId,
      },
      select: { id: true },
    }));
  }
  if (resources.programmeId) {
    checks.push(transaction.membershipProgrammeScope.findFirst({
      where: {
        organizationId: context.organizationId,
        membershipId: context.membershipId,
        programmeId: resources.programmeId,
      },
      select: { id: true },
    }));
  }
  const results = await Promise.all(checks);
  if (results.some((result) => !result)) {
    throw new DomainError(
      403,
      'RESOURCE_SCOPE_ACCESS_DENIED',
      'The requested facility or programme is outside this membership scope'
    );
  }
}

function createResourceScopeService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function replace(context, membershipId, input) {
    const facilityIds = normalizeIds(input.facilityIds || [], 'facilityIds');
    const programmeIds = normalizeIds(input.programmeIds || [], 'programmeIds');
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const membership = await transaction.organizationMembership.findFirst({
        where: {
          id: membershipId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      if (!membership) {
        throw new DomainError(
          404,
          'ACTIVE_MEMBERSHIP_NOT_FOUND',
          'Active organization membership not found'
        );
      }
      if (membership.role === 'OWNER') {
        throw new DomainError(
          409,
          'OWNER_SCOPE_NOT_ALLOWED',
          'Organization owners must retain global scope'
        );
      }
      if (membership.scopeMode === 'SCOPED' && facilityIds.length + programmeIds.length === 0) {
        throw new DomainError(
          400,
          'RESOURCE_SCOPE_REQUIRED',
          'A scoped membership requires at least one facility or programme'
        );
      }
      const [facilityCount, programmeCount] = await Promise.all([
        transaction.facility.count({
          where: {
            organizationId: context.organizationId,
            id: { in: facilityIds },
            isActive: true,
          },
        }),
        transaction.programme.count({
          where: {
            organizationId: context.organizationId,
            id: { in: programmeIds },
            isActive: true,
          },
        }),
      ]);
      if (
        facilityCount !== facilityIds.length
        || programmeCount !== programmeIds.length
      ) {
        throw new DomainError(
          404,
          'RESOURCE_SCOPE_TARGET_NOT_FOUND',
          'One or more active scope targets were not found'
        );
      }
      await Promise.all([
        transaction.membershipFacilityScope.deleteMany({
          where: { organizationId: context.organizationId, membershipId },
        }),
        transaction.membershipProgrammeScope.deleteMany({
          where: { organizationId: context.organizationId, membershipId },
        }),
      ]);
      if (facilityIds.length > 0) {
        await transaction.membershipFacilityScope.createMany({
          data: facilityIds.map((facilityId) => ({
            organizationId: context.organizationId,
            membershipId,
            facilityId,
            assignedBySubjectId: context.actorSubjectId,
          })),
        });
      }
      if (programmeIds.length > 0) {
        await transaction.membershipProgrammeScope.createMany({
          data: programmeIds.map((programmeId) => ({
            organizationId: context.organizationId,
            membershipId,
            programmeId,
            assignedBySubjectId: context.actorSubjectId,
          })),
        });
      }
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'membership.resource-scopes-replaced',
          entityType: 'organization-membership',
          entityId: membershipId,
          purpose: context.purpose,
          metadata: {
            facilityCount: facilityIds.length,
            programmeCount: programmeIds.length,
          },
        },
      });
      return {
        membershipId,
        scopeMode: membership.scopeMode,
        facilityIds,
        programmeIds,
      };
    });
  }

  return { replace };
}

module.exports = {
  createResourceScopeService,
  assertResourceScope,
  normalizeIds,
};
