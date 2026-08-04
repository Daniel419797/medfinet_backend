const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { positiveCredits } = require('./credits');
const {
  ledgerEntries,
  householdAvailable,
  householdReserved,
} = require('./rewardLedger');

const MIN_RESERVATION_MINUTES = 5;
const MAX_RESERVATION_MINUTES = 30;

function reservationToken(secret, organizationId, accountId, idempotencyKey) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${organizationId}:${accountId}:${idempotencyKey}`)
    .digest('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function reservationMinutes(value) {
  const minutes = value === undefined ? 15 : Number(value);
  if (
    !Number.isInteger(minutes)
    || minutes < MIN_RESERVATION_MINUTES
    || minutes > MAX_RESERVATION_MINUTES
  ) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `expiresInMinutes must be between ${MIN_RESERVATION_MINUTES} and ${MAX_RESERVATION_MINUTES}`
    );
  }
  return minutes;
}

function canUseAccount(context, account) {
  return (
    ['OWNER', 'ADMIN'].includes(context.role)
    || account.caregiver.subjectId === context.actorSubjectId
  );
}

function createRewardReservationService(
  prismaClient,
  { now = () => new Date(), tokenSecret } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const secret = tokenSecret || require('../config').security.rewardTokenSecret;

  async function createReservation(context, accountId, merchantId, input) {
    const category = requiredText(input.category, 'category', 80).toUpperCase();
    const amount = positiveCredits(input.amount, 'amount');
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 160);
    const token = reservationToken(
      secret,
      context.organizationId,
      accountId,
      idempotencyKey
    );
    const expiresAt = new Date(
      now().getTime() + reservationMinutes(input.expiresInMinutes) * 60_000
    );

    const result = await withTenantTransaction(
      database,
      context.organizationId,
      async (transaction) => {
        const replay = await transaction.rewardTransaction.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: context.organizationId,
              idempotencyKey: `reward-reserve:${idempotencyKey}`,
            },
          },
        });
        if (replay) {
          const reservation = await transaction.rewardReservation.findFirst({
            where: {
              id: replay.referenceId,
              organizationId: context.organizationId,
            },
          });
          return { reservation, transaction: replay, idempotentReplay: true };
        }

        const [account, merchant] = await Promise.all([
          transaction.rewardAccount.findFirst({
            where: {
              id: accountId,
              organizationId: context.organizationId,
              status: 'ACTIVE',
            },
            include: { caregiver: { select: { subjectId: true } } },
          }),
          transaction.merchant.findFirst({
            where: {
              id: merchantId,
              organizationId: context.organizationId,
              status: 'ACTIVE',
            },
          }),
        ]);
        if (!account || !canUseAccount(context, account)) {
          throw new DomainError(
            404,
            'REWARD_ACCOUNT_NOT_FOUND',
            'Accessible active reward account not found'
          );
        }
        if (!merchant) {
          throw new DomainError(404, 'ACTIVE_MERCHANT_NOT_FOUND', 'Active merchant not found');
        }
        if (
          !Array.isArray(merchant.eligibleCategories)
          || !merchant.eligibleCategories.includes(category)
        ) {
          throw new DomainError(
            409,
            'REWARD_CATEGORY_NOT_ELIGIBLE',
            'The merchant cannot redeem this reward category'
          );
        }

        await transaction.$queryRawUnsafe(
          'SELECT "id" FROM "reward_accounts" WHERE "id" = $1 FOR UPDATE',
          account.id
        );
        const updated = await transaction.rewardAccount.updateMany({
          where: {
            id: account.id,
            organizationId: context.organizationId,
            status: 'ACTIVE',
            balance: { gte: amount },
          },
          data: {
            balance: { decrement: amount },
            reservedBalance: { increment: amount },
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new DomainError(
            409,
            'INSUFFICIENT_REWARD_BALANCE',
            'The reward account does not have enough available credits'
          );
        }
        const currentAccount = await transaction.rewardAccount.findUnique({
          where: { id: account.id },
        });
        const reservation = await transaction.rewardReservation.create({
          data: {
            organizationId: context.organizationId,
            rewardAccountId: account.id,
            merchantId,
            category,
            amount,
            tokenHash: tokenHash(token),
            expiresAt,
            createdBySubjectId: context.actorSubjectId,
          },
        });
        const ledgerTransaction = await transaction.rewardTransaction.create({
          data: {
            organizationId: context.organizationId,
            rewardAccountId: account.id,
            merchantId,
            type: 'RESERVE',
            amount: -amount,
            balanceAfter: currentAccount.balance,
            reservedBalanceAfter: currentAccount.reservedBalance,
            idempotencyKey: `reward-reserve:${idempotencyKey}`,
            referenceType: 'REWARD_RESERVATION',
            referenceId: reservation.id,
            metadata: { category, expiresAt: expiresAt.toISOString() },
            createdBySubjectId: context.actorSubjectId,
            entries: ledgerEntries(
              context.organizationId,
              householdAvailable(account.id),
              householdReserved(account.id),
              amount
            ),
          },
        });
        await transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'reward.reserved',
            entityType: 'reward-reservation',
            entityId: reservation.id,
            purpose: context.purpose,
            metadata: { merchantId, category, amount: amount.toString() },
          },
        });
        return {
          reservation,
          transaction: ledgerTransaction,
          idempotentReplay: false,
        };
      }
    );

    return { ...result, redemptionToken: token };
  }

  return { createReservation };
}

module.exports = {
  createRewardReservationService,
  reservationToken,
  tokenHash,
  reservationMinutes,
  canUseAccount,
};
