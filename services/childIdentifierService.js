const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

function normalizeSystem(value) {
  const system = requiredText(value, 'system', 120).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(system)) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'system must be a stable lowercase namespace'
    );
  }
  return system;
}

function createChildIdentifierService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function create(context, childId, input) {
    const system = normalizeSystem(input.system);
    const value = requiredText(input.value, 'value', 200);
    const evidenceReference = input.evidenceReference
      ? requiredText(input.evidenceReference, 'evidenceReference', 500)
      : null;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await transaction.child.findFirst({
        where: {
          id: childId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
      const identifier = await transaction.childIdentifier.create({
        data: {
          organizationId: context.organizationId,
          childId,
          system,
          value,
          isPrimary: input.isPrimary === true,
          evidenceReference,
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'child-identifier.created',
          entityType: 'child-identifier',
          entityId: identifier.id,
          purpose: context.purpose,
          metadata: { childId, system, isPrimary: identifier.isPrimary },
        },
      });
      return identifier;
    });
  }

  async function verify(context, identifierId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const identifier = await transaction.childIdentifier.findFirst({
        where: {
          id: identifierId,
          organizationId: context.organizationId,
          status: 'PENDING',
        },
      });
      if (!identifier) {
        throw new DomainError(
          404,
          'PENDING_CHILD_IDENTIFIER_NOT_FOUND',
          'Pending child identifier not found'
        );
      }
      if (identifier.createdBySubjectId === context.actorSubjectId) {
        throw new DomainError(
          409,
          'CHILD_IDENTIFIER_MAKER_CHECKER_REQUIRED',
          'A different authorized worker must verify this identifier'
        );
      }
      const verified = await transaction.childIdentifier.update({
        where: { id: identifier.id },
        data: {
          status: 'VERIFIED',
          verifiedBySubjectId: context.actorSubjectId,
          verifiedAt: new Date(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'child-identifier.verified',
          entityType: 'child-identifier',
          entityId: identifier.id,
          purpose: context.purpose,
          metadata: { childId: identifier.childId, system: identifier.system },
        },
      });
      return verified;
    });
  }

  async function revoke(context, identifierId, input) {
    const reason = requiredText(input.reason, 'reason', 500);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const identifier = await transaction.childIdentifier.findFirst({
        where: {
          id: identifierId,
          organizationId: context.organizationId,
          status: { in: ['PENDING', 'VERIFIED'] },
        },
      });
      if (!identifier) {
        throw new DomainError(404, 'CHILD_IDENTIFIER_NOT_FOUND', 'Active identifier not found');
      }
      const revoked = await transaction.childIdentifier.update({
        where: { id: identifier.id },
        data: {
          status: 'REVOKED',
          isPrimary: false,
          revokedBySubjectId: context.actorSubjectId,
          revokedAt: new Date(),
          revocationReason: reason,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'child-identifier.revoked',
          entityType: 'child-identifier',
          entityId: identifier.id,
          purpose: context.purpose,
          metadata: { childId: identifier.childId, reason },
        },
      });
      return revoked;
    });
  }

  async function list(context, childId) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.childIdentifier.findMany({
        where: { organizationId: context.organizationId, childId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      })
    ));
  }

  return { create, verify, revoke, list };
}

module.exports = { createChildIdentifierService, normalizeSystem };
