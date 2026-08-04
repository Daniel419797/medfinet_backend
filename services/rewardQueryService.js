const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

function page(input = {}) {
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100');
  }
  return {
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  };
}

function paged(items, limit) {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  return {
    items: data,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  };
}

function serializeBigInts(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)])
    );
  }
  return value;
}

function canUseAccount(context, account) {
  return (
    ['OWNER', 'ADMIN'].includes(context.role)
    || account.caregiver.subjectId === context.actorSubjectId
  );
}

function createRewardQueryService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function listCampaigns(context, input) {
    const pagination = page(input);
    const limit = pagination.take - 1;
    const isAdministrator = ['OWNER', 'ADMIN'].includes(context.role);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const items = await transaction.rewardCampaign.findMany({
        where: {
          organizationId: context.organizationId,
          ...(
            isAdministrator
              ? (input.status ? { status: input.status } : {})
              : {
                status: 'ACTIVE',
                startsAt: { lte: new Date() },
                endsAt: { gt: new Date() },
              }
          ),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pagination,
      });
      return serializeBigInts(paged(items, limit));
    });
  }

  async function listMerchants(context, input) {
    const pagination = page(input);
    const limit = pagination.take - 1;
    const isAdministrator = ['OWNER', 'ADMIN'].includes(context.role);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const items = await transaction.merchant.findMany({
        where: {
          organizationId: context.organizationId,
          ...(
            isAdministrator
              ? (input.status ? { status: input.status } : {})
              : { status: 'ACTIVE' }
          ),
        },
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          eligibleCategories: true,
          approvedAt: true,
          createdAt: true,
          ...(isAdministrator
            ? {
              settlementAccountRef: true,
              suspendedAt: true,
              suspensionReason: true,
            }
            : {}),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pagination,
      });
      return serializeBigInts(paged(items, limit));
    });
  }

  async function listMyMerchants(context) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => (
      transaction.merchantMembership.findMany({
        where: {
          organizationId: context.organizationId,
          subjectId: context.actorSubjectId,
          status: 'ACTIVE',
          merchant: { status: 'ACTIVE' },
        },
        select: {
          id: true,
          role: true,
          merchant: {
            select: {
              id: true,
              name: true,
              code: true,
              eligibleCategories: true,
              status: true,
            },
          },
        },
        orderBy: { merchant: { name: 'asc' } },
      })
    ));
  }

  async function getAccount(context, accountId, input) {
    const pagination = page(input);
    const limit = pagination.take - 1;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const account = await transaction.rewardAccount.findFirst({
        where: { id: accountId, organizationId: context.organizationId },
        include: {
          caregiver: { select: { id: true, subjectId: true, firstName: true, lastName: true } },
        },
      });
      if (!account || !canUseAccount(context, account)) {
        throw new DomainError(
          404,
          'REWARD_ACCOUNT_NOT_FOUND',
          'Accessible reward account not found'
        );
      }
      const transactions = await transaction.rewardTransaction.findMany({
        where: {
          organizationId: context.organizationId,
          rewardAccountId: account.id,
        },
        include: {
          entries: {
            select: { accountCode: true, debit: true, credit: true },
            orderBy: { accountCode: 'asc' },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pagination,
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'reward-account.read',
          entityType: 'reward-account',
          entityId: account.id,
          purpose: context.purpose,
        },
      });
      return serializeBigInts({
        account: {
          ...account,
          caregiver: {
            id: account.caregiver.id,
            firstName: account.caregiver.firstName,
            lastName: account.caregiver.lastName,
          },
        },
        transactions: paged(transactions, limit),
      });
    });
  }

  async function getMyAccount(context, input = {}) {
    const pagination = page(input);
    const limit = pagination.take - 1;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const account = await transaction.rewardAccount.findFirst({
        where: {
          organizationId: context.organizationId,
          caregiver: { subjectId: context.actorSubjectId },
        },
        include: {
          caregiver: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      if (!account) return null;
      const transactions = await transaction.rewardTransaction.findMany({
        where: {
          organizationId: context.organizationId,
          rewardAccountId: account.id,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pagination,
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'reward-account.read',
          entityType: 'reward-account',
          entityId: account.id,
          purpose: context.purpose,
        },
      });
      return serializeBigInts({ account, transactions: paged(transactions, limit) });
    });
  }

  async function listSettlements(context, input) {
    const pagination = page(input);
    const limit = pagination.take - 1;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const items = await transaction.settlementBatch.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.merchantId ? { merchantId: input.merchantId } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          merchant: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pagination,
      });
      return serializeBigInts(paged(items, limit));
    });
  }

  return {
    listCampaigns,
    listMerchants,
    listMyMerchants,
    getAccount,
    getMyAccount,
    listSettlements,
  };
}

module.exports = { createRewardQueryService, page, paged, canUseAccount, serializeBigInts };
