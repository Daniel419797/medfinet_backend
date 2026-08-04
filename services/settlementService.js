const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { timestamp } = require('./clinicalService');

const SETTLEMENT_TRANSITIONS = {
  APPROVED: new Set(['PROCESSING', 'CANCELLED']),
  PROCESSING: new Set(['PAID', 'FAILED']),
  FAILED: new Set(['PROCESSING', 'CANCELLED']),
};

function audit(context, action, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: context.actorSubjectId,
    action,
    entityType: 'settlement-batch',
    entityId,
    purpose: context.purpose,
    ...(metadata ? { metadata } : {}),
  };
}

function createSettlementService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function createBatch(context, merchantId, input) {
    const periodStart = timestamp(input.periodStart, 'periodStart');
    const periodEnd = timestamp(input.periodEnd, 'periodEnd');
    if (periodEnd <= periodStart) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'periodEnd must be later than periodStart');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const merchant = await transaction.merchant.findFirst({
        where: {
          id: merchantId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      if (!merchant) {
        throw new DomainError(404, 'ACTIVE_MERCHANT_NOT_FOUND', 'Active merchant not found');
      }
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "merchants" WHERE "id" = $1 FOR UPDATE',
        merchant.id
      );
      const overlapping = await transaction.settlementBatch.findFirst({
        where: {
          organizationId: context.organizationId,
          merchantId,
          status: { not: 'CANCELLED' },
          periodStart: { lt: periodEnd },
          periodEnd: { gt: periodStart },
        },
        select: { id: true },
      });
      if (overlapping) {
        throw new DomainError(
          409,
          'SETTLEMENT_PERIOD_OVERLAP',
          'A non-cancelled settlement batch overlaps this period'
        );
      }
      const redemptions = await transaction.rewardRedemption.findMany({
        where: {
          organizationId: context.organizationId,
          merchantId,
          status: 'COMPLETED',
          settlementBatchId: null,
          redeemedAt: { gte: periodStart, lt: periodEnd },
        },
        select: { id: true, amount: true },
        orderBy: [{ redeemedAt: 'asc' }, { id: 'asc' }],
      });
      if (redemptions.length === 0) {
        throw new DomainError(
          409,
          'NO_UNSETTLED_REDEMPTIONS',
          'No unsettled redemptions exist for this period'
        );
      }
      const totalCredits = redemptions.reduce((total, item) => total + item.amount, 0n);
      const batch = await transaction.settlementBatch.create({
        data: {
          organizationId: context.organizationId,
          merchantId,
          periodStart,
          periodEnd,
          totalCredits,
          redemptionCount: redemptions.length,
          createdBySubjectId: context.actorSubjectId,
        },
      });
      const assigned = await transaction.rewardRedemption.updateMany({
        where: {
          id: { in: redemptions.map(({ id }) => id) },
          organizationId: context.organizationId,
          settlementBatchId: null,
          status: 'COMPLETED',
        },
        data: { settlementBatchId: batch.id },
      });
      if (assigned.count !== redemptions.length) {
        throw new DomainError(
          409,
          'SETTLEMENT_ASSIGNMENT_CONFLICT',
          'A redemption was assigned concurrently; retry the settlement'
        );
      }
      await transaction.auditEvent.create({
        data: audit(context, 'settlement.created', batch.id, {
          merchantId,
          totalCredits: totalCredits.toString(),
          redemptionCount: redemptions.length,
        }),
      });
      return batch;
    });
  }

  async function approveBatch(context, batchId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.settlementBatch.findFirst({
        where: {
          id: batchId,
          organizationId: context.organizationId,
          status: 'DRAFT',
        },
      });
      if (!existing) {
        throw new DomainError(404, 'DRAFT_SETTLEMENT_NOT_FOUND', 'Draft settlement not found');
      }
      if (existing.createdBySubjectId === context.actorSubjectId) {
        throw new DomainError(
          409,
          'SETTLEMENT_MAKER_CHECKER_REQUIRED',
          'A different administrator must approve this settlement'
        );
      }
      const approvedAt = now();
      const batch = await transaction.settlementBatch.update({
        where: { id: existing.id },
        data: {
          status: 'APPROVED',
          approvedBySubjectId: context.actorSubjectId,
          approvedAt,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'settlement.approved', batch.id),
      });
      return batch;
    });
  }

  async function transitionBatch(context, batchId, input) {
    const targetStatus = input.status;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.settlementBatch.findFirst({
        where: { id: batchId, organizationId: context.organizationId },
      });
      if (!existing) {
        throw new DomainError(404, 'SETTLEMENT_NOT_FOUND', 'Settlement batch not found');
      }
      if (!SETTLEMENT_TRANSITIONS[existing.status]?.has(targetStatus)) {
        throw new DomainError(
          409,
          'INVALID_SETTLEMENT_TRANSITION',
          `Settlement cannot transition from ${existing.status} to ${targetStatus}`
        );
      }
      const transitionTime = now();
      const data = { status: targetStatus };
      if (targetStatus === 'PAID') {
        data.paymentReference = requiredText(
          input.paymentReference,
          'paymentReference',
          200
        );
        data.paidAt = transitionTime;
      }
      if (targetStatus === 'FAILED') {
        data.failureReason = requiredText(input.failureReason, 'failureReason', 500);
        data.failedAt = transitionTime;
      }
      if (targetStatus === 'PROCESSING' && existing.status === 'FAILED') {
        data.failureReason = null;
        data.failedAt = null;
      }
      const batch = await transaction.settlementBatch.update({
        where: { id: existing.id },
        data,
      });
      await Promise.all([
        transaction.auditEvent.create({
          data: audit(context, 'settlement.status-changed', batch.id, {
            from: existing.status,
            to: targetStatus,
          }),
        }),
        targetStatus === 'PAID'
          ? transaction.outboxEvent.create({
            data: {
              organizationId: context.organizationId,
              eventType: 'SETTLEMENT_PAID',
              aggregateType: 'settlement-batch',
              aggregateId: batch.id,
              idempotencyKey: `settlement:${batch.id}:paid-notification`,
              payload: { settlementBatchId: batch.id, merchantId: batch.merchantId },
            },
          })
          : Promise.resolve(),
      ]);
      return batch;
    });
  }

  return { createBatch, approveBatch, transitionBatch };
}

module.exports = { createSettlementService, SETTLEMENT_TRANSITIONS };
