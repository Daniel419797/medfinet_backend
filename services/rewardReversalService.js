const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const {
  ledgerEntries,
  householdAvailable,
  householdReserved,
  merchantPayable,
} = require('./rewardLedger');

function createRewardReversalService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function releaseExpired(context, reservationId) {
    const currentTime = now();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "reward_reservations" WHERE "id" = $1 FOR UPDATE',
        reservationId
      );
      const reservation = await transaction.rewardReservation.findFirst({
        where: {
          id: reservationId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          expiresAt: { lte: currentTime },
        },
      });
      if (!reservation) {
        throw new DomainError(
          404,
          'EXPIRED_REWARD_RESERVATION_NOT_FOUND',
          'Expired active reward reservation not found'
        );
      }
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "reward_accounts" WHERE "id" = $1 FOR UPDATE',
        reservation.rewardAccountId
      );
      const account = await transaction.rewardAccount.update({
        where: { id: reservation.rewardAccountId },
        data: {
          balance: { increment: reservation.amount },
          reservedBalance: { decrement: reservation.amount },
          version: { increment: 1 },
        },
      });
      const ledgerTransaction = await transaction.rewardTransaction.create({
        data: {
          organizationId: context.organizationId,
          rewardAccountId: reservation.rewardAccountId,
          merchantId: reservation.merchantId,
          type: 'RELEASE',
          amount: reservation.amount,
          balanceAfter: account.balance,
          reservedBalanceAfter: account.reservedBalance,
          idempotencyKey: `reward-release:${reservation.id}`,
          referenceType: 'REWARD_RESERVATION',
          referenceId: reservation.id,
          createdBySubjectId: context.actorSubjectId,
          entries: ledgerEntries(
            context.organizationId,
            householdReserved(reservation.rewardAccountId),
            householdAvailable(reservation.rewardAccountId),
            reservation.amount
          ),
        },
      });
      const released = await transaction.rewardReservation.update({
        where: { id: reservation.id },
        data: { status: 'EXPIRED', releasedAt: currentTime },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'reward.reservation-expired',
          entityType: 'reward-reservation',
          entityId: reservation.id,
          purpose: context.purpose,
          metadata: { amount: reservation.amount.toString() },
        },
      });
      return { reservation: released, transaction: ledgerTransaction };
    });
  }

  async function reverseRedemption(context, redemptionId, input) {
    const reason = requiredText(input.reason, 'reason', 500);
    const currentTime = now();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "reward_redemptions" WHERE "id" = $1 FOR UPDATE',
        redemptionId
      );
      const redemption = await transaction.rewardRedemption.findFirst({
        where: {
          id: redemptionId,
          organizationId: context.organizationId,
          status: 'COMPLETED',
        },
        include: {
          rewardReservation: true,
          rewardTransaction: true,
          settlementBatch: true,
        },
      });
      if (!redemption) {
        throw new DomainError(
          404,
          'COMPLETED_REDEMPTION_NOT_FOUND',
          'Completed reward redemption not found'
        );
      }
      if (
        redemption.settlementBatch
        && ['APPROVED', 'PROCESSING', 'PAID'].includes(redemption.settlementBatch.status)
      ) {
        throw new DomainError(
          409,
          'SETTLED_REDEMPTION_CANNOT_BE_REVERSED',
          'Approved or paid settlement redemptions cannot be reversed'
        );
      }
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "reward_accounts" WHERE "id" = $1 FOR UPDATE',
        redemption.rewardReservation.rewardAccountId
      );
      const account = await transaction.rewardAccount.update({
        where: { id: redemption.rewardReservation.rewardAccountId },
        data: {
          balance: { increment: redemption.amount },
          version: { increment: 1 },
        },
      });
      const ledgerTransaction = await transaction.rewardTransaction.create({
        data: {
          organizationId: context.organizationId,
          rewardAccountId: account.id,
          merchantId: redemption.merchantId,
          type: 'REVERSAL',
          amount: redemption.amount,
          balanceAfter: account.balance,
          reservedBalanceAfter: account.reservedBalance,
          idempotencyKey: `reward-reversal:${redemption.id}`,
          referenceType: 'REWARD_REDEMPTION',
          referenceId: redemption.id,
          reversalOfTransactionId: redemption.rewardTransactionId,
          metadata: { reason },
          createdBySubjectId: context.actorSubjectId,
          entries: ledgerEntries(
            context.organizationId,
            merchantPayable(redemption.merchantId),
            householdAvailable(account.id),
            redemption.amount
          ),
        },
      });
      const reversed = await transaction.rewardRedemption.update({
        where: { id: redemption.id },
        data: {
          status: 'REVERSED',
          reversedAt: currentTime,
          reversedBySubjectId: context.actorSubjectId,
          reversalReason: reason,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'reward.redemption-reversed',
          entityType: 'reward-redemption',
          entityId: redemption.id,
          purpose: context.purpose,
          metadata: { reason, amount: redemption.amount.toString() },
        },
      });
      return { redemption: reversed, transaction: ledgerTransaction };
    });
  }

  return { releaseExpired, reverseRedemption };
}

module.exports = { createRewardReversalService };
