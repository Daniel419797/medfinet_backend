const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const TARGET_TYPES = new Set(['CHILD', 'CAREGIVER', 'ORGANIZATION']);

function createLegalHoldService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function place(context, input) {
    if (!TARGET_TYPES.has(input.targetType)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'targetType is invalid');
    }
    const targetReference = requiredText(
      input.targetReference,
      'targetReference',
      100
    );
    const reason = requiredText(input.reason, 'reason', 1000);
    const legalAuthority = requiredText(
      input.legalAuthority,
      'legalAuthority',
      1000
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      if (input.targetType === 'ORGANIZATION') {
        if (targetReference !== context.organizationId) {
          throw new DomainError(
            400,
            'LEGAL_HOLD_TARGET_INVALID',
            'Organization hold must target the verified organization'
          );
        }
      } else {
        const delegate = input.targetType === 'CHILD'
          ? transaction.child
          : transaction.caregiver;
        const target = await delegate.findFirst({
          where: {
            id: targetReference,
            organizationId: context.organizationId,
          },
          select: { id: true },
        });
        if (!target) {
          throw new DomainError(
            404,
            'LEGAL_HOLD_TARGET_NOT_FOUND',
            'Legal-hold target not found'
          );
        }
      }
      const hold = await transaction.legalHold.create({
        data: {
          organizationId: context.organizationId,
          childId: input.targetType === 'CHILD' ? targetReference : null,
          targetType: input.targetType,
          targetReference,
          reason,
          legalAuthority,
          placedBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'legal-hold.placed',
          entityType: 'legal-hold',
          entityId: hold.id,
          purpose: context.purpose,
          metadata: {
            targetType: hold.targetType,
            targetReference: hold.targetReference,
          },
        },
      });
      return hold;
    });
  }

  async function release(context, holdId, input) {
    const releaseReason = requiredText(
      input.releaseReason,
      'releaseReason',
      1000
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const releasedAt = new Date();
      const updated = await transaction.legalHold.updateMany({
        where: {
          id: holdId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        data: {
          status: 'RELEASED',
          releasedBySubjectId: context.actorSubjectId,
          releasedAt,
          releaseReason,
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'LEGAL_HOLD_NOT_RELEASABLE',
          'Legal hold is not active'
        );
      }
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'legal-hold.released',
          entityType: 'legal-hold',
          entityId: holdId,
          purpose: context.purpose,
          metadata: { releaseReason },
        },
      });
      return transaction.legalHold.findUnique({ where: { id: holdId } });
    });
  }

  async function list(context, input = {}) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.legalHold.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: { placedAt: 'desc' },
        take: 100,
      })
    ));
  }

  return { place, release, list };
}

module.exports = {
  createLegalHoldService,
  TARGET_TYPES,
};
