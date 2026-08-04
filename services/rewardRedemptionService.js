const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { tokenHash } = require('./rewardReservationService');
const {
  ledgerEntries,
  householdReserved,
  merchantPayable,
} = require('./rewardLedger');

function createRewardRedemptionService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function redeem(context, merchantId, input) {
    const token = requiredText(input.token, 'token', 200);
    const merchantReference = requiredText(
      input.merchantReference,
      'merchantReference',
      160
    );
    const currentTime = now();

    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.rewardRedemption.findUnique({
        where: { merchantId_merchantReference: { merchantId, merchantReference } },
        include: { rewardReservation: true, rewardTransaction: true },
      });
      if (replay) return { redemption: replay, idempotentReplay: true };

      const reservation = await transaction.rewardReservation.findFirst({
        where: {
          organizationId: context.organizationId,
          merchantId,
          tokenHash: tokenHash(token),
        },
      });
      if (!reservation) {
        throw new DomainError(
          404,
          'REWARD_RESERVATION_NOT_FOUND',
          'Reward reservation not found'
        );
      }
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "reward_reservations" WHERE "id" = $1 FOR UPDATE',
        reservation.id
      );
      const activeReservation = await transaction.rewardReservation.findFirst({
        where: {
          id: reservation.id,
          organizationId: context.organizationId,
          merchantId,
          status: 'ACTIVE',
          expiresAt: { gt: currentTime },
        },
      });
      if (!activeReservation) {
        throw new DomainError(
          409,
          'REWARD_RESERVATION_UNAVAILABLE',
          'Reward reservation is expired or already used'
        );
      }

      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "reward_accounts" WHERE "id" = $1 FOR UPDATE',
        activeReservation.rewardAccountId
      );
      const accountUpdate = await transaction.rewardAccount.updateMany({
        where: {
          id: activeReservation.rewardAccountId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          reservedBalance: { gte: activeReservation.amount },
        },
        data: {
          reservedBalance: { decrement: activeReservation.amount },
          version: { increment: 1 },
        },
      });
      if (accountUpdate.count !== 1) {
        throw new DomainError(
          409,
          'REWARD_ACCOUNT_STATE_CONFLICT',
          'Reward account balance changed; retry the redemption'
        );
      }
      const account = await transaction.rewardAccount.findUnique({
        where: { id: activeReservation.rewardAccountId },
      });
      const ledgerTransaction = await transaction.rewardTransaction.create({
        data: {
          organizationId: context.organizationId,
          rewardAccountId: activeReservation.rewardAccountId,
          merchantId,
          type: 'REDEEM',
          amount: -activeReservation.amount,
          balanceAfter: account.balance,
          reservedBalanceAfter: account.reservedBalance,
          idempotencyKey: `reward-redeem:${merchantId}:${merchantReference}`,
          referenceType: 'REWARD_RESERVATION',
          referenceId: activeReservation.id,
          metadata: { category: activeReservation.category },
          createdBySubjectId: context.actorSubjectId,
          entries: ledgerEntries(
            context.organizationId,
            householdReserved(activeReservation.rewardAccountId),
            merchantPayable(merchantId),
            activeReservation.amount
          ),
        },
      });
      const redemption = await transaction.rewardRedemption.create({
        data: {
          organizationId: context.organizationId,
          rewardReservationId: activeReservation.id,
          rewardTransactionId: ledgerTransaction.id,
          merchantId,
          amount: activeReservation.amount,
          merchantReference,
          redeemedBySubjectId: context.actorSubjectId,
          redeemedAt: currentTime,
        },
      });
      await transaction.rewardReservation.update({
        where: { id: activeReservation.id },
        data: { status: 'CONSUMED', consumedAt: currentTime },
      });
      await Promise.all([
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'REWARD_REDEEMED',
            aggregateType: 'reward-redemption',
            aggregateId: redemption.id,
            idempotencyKey: `reward-redemption:${redemption.id}:notification`,
            payload: {
              redemptionId: redemption.id,
              merchantId,
              rewardAccountId: activeReservation.rewardAccountId,
            },
          },
        }),
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'reward.redeemed',
            entityType: 'reward-redemption',
            entityId: redemption.id,
            purpose: context.purpose,
            metadata: {
              merchantId,
              category: activeReservation.category,
              amount: activeReservation.amount.toString(),
            },
          },
        }),
      ]);
      return { redemption, transaction: ledgerTransaction, idempotentReplay: false };
    });
  }

  return { redeem };
}

module.exports = { createRewardRedemptionService };
