const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { VULNERABILITY_LEVELS } = require('./climateEventService');

const REFERRAL_TRANSITIONS = {
  OPEN: new Set(['ACCEPTED', 'COMPLETED', 'CANCELLED']),
  ACCEPTED: new Set(['COMPLETED', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

function audit(context, action, entityType, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: context.actorSubjectId,
    action,
    entityType,
    entityId,
    purpose: context.purpose,
    ...(metadata ? { metadata } : {}),
  };
}

function createReferralService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function createReferral(context, entryId, input) {
    if (!VULNERABILITY_LEVELS.has(input.priority)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'priority is unsupported');
    }
    const sourceOperationId = requiredText(
      input.sourceOperationId,
      'sourceOperationId',
      120
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.referral.findUnique({
        where: {
          organizationId_sourceOperationId: {
            organizationId: context.organizationId,
            sourceOperationId,
          },
        },
      });
      if (replay) return { referral: replay, idempotentReplay: true };

      const entry = await transaction.worklistEntry.findFirst({
        where: {
          id: entryId,
          organizationId: context.organizationId,
          eligibility: 'ELIGIBLE',
          worklist: { status: { in: ['AUTHORIZED', 'ACTIVE'] } },
        },
        include: { worklist: { select: { id: true, status: true } } },
      });
      if (!entry) {
        throw new DomainError(
          404,
          'OPERATIONAL_WORKLIST_ENTRY_NOT_FOUND',
          'Eligible entry in an authorized worklist not found'
        );
      }
      const referral = await transaction.referral.create({
        data: {
          organizationId: context.organizationId,
          worklistEntryId: entry.id,
          childId: entry.childId,
          referralType: requiredText(input.referralType, 'referralType', 100),
          destination: requiredText(input.destination, 'destination', 200),
          priority: input.priority,
          reason: requiredText(input.reason, 'reason', 1000),
          openedBySubjectId: context.actorSubjectId,
          sourceOperationId,
        },
      });
      const completedAt = now();
      await Promise.all([
        transaction.worklistEntry.update({
          where: { id: entry.id },
          data: { status: 'REFERRED', completedAt },
        }),
        entry.worklist.status === 'AUTHORIZED'
          ? transaction.beneficiaryWorklist.update({
            where: { id: entry.worklist.id },
            data: { status: 'ACTIVE' },
          })
          : Promise.resolve(),
        transaction.auditEvent.create({
          data: audit(context, 'referral.opened', 'referral', referral.id, {
            childId: entry.childId,
            worklistId: entry.worklist.id,
            destination: referral.destination,
          }),
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'REFERRAL_OPENED',
            aggregateType: 'referral',
            aggregateId: referral.id,
            idempotencyKey: `referral:${referral.id}:opened-notification`,
            payload: { referralId: referral.id },
          },
        }),
      ]);
      return { referral, idempotentReplay: false };
    });
  }

  async function transitionReferral(context, referralId, input) {
    const targetStatus = input.status;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.referral.findFirst({
        where: { id: referralId, organizationId: context.organizationId },
      });
      if (!existing) throw new DomainError(404, 'REFERRAL_NOT_FOUND', 'Referral not found');
      if (!REFERRAL_TRANSITIONS[existing.status]?.has(targetStatus)) {
        throw new DomainError(
          409,
          'INVALID_REFERRAL_TRANSITION',
          `Referral cannot transition from ${existing.status} to ${targetStatus}`
        );
      }
      const terminal = ['COMPLETED', 'CANCELLED'].includes(targetStatus);
      const closureNotes = terminal
        ? requiredText(input.closureNotes, 'closureNotes', 1000)
        : null;
      const transitionTime = now();
      const referral = await transaction.referral.update({
        where: { id: existing.id },
        data: {
          status: targetStatus,
          ...(terminal
            ? {
              closedBySubjectId: context.actorSubjectId,
              closedAt: transitionTime,
              closureNotes,
            }
            : {}),
        },
      });
      await Promise.all([
        transaction.auditEvent.create({
          data: audit(context, 'referral.status-changed', 'referral', referral.id, {
            from: existing.status,
            to: targetStatus,
            childId: existing.childId,
          }),
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'REFERRAL_STATUS_CHANGED',
            aggregateType: 'referral',
            aggregateId: referral.id,
            idempotencyKey: `referral:${referral.id}:status:${targetStatus}:notification`,
            payload: { referralId: referral.id },
          },
        }),
      ]);
      return referral;
    });
  }

  return { createReferral, transitionReferral };
}

module.exports = { createReferralService, REFERRAL_TRANSITIONS };
