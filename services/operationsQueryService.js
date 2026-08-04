const { withTenantTransaction } = require('./tenantContext');
const { DomainError } = require('../utils/domainError');

function boundedLimit(value) {
  const parsed = Number(value || 50);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new DomainError(400, 'INVALID_PAGE_LIMIT', 'limit must be an integer from 1 to 100');
  }
  return parsed;
}

function createOperationsQueryService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function query(context, operation) {
    return withTenantTransaction(database, context.organizationId, operation);
  }

  function listCaregivers(context, input = {}) {
    return query(context, (transaction) => transaction.caregiver.findMany({
      where: {
        organizationId: context.organizationId,
        ...(input.search ? {
          OR: [
            { firstName: { contains: input.search, mode: 'insensitive' } },
            { lastName: { contains: input.search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      take: boundedLimit(input.limit),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true, firstName: true, lastName: true, preferredLanguage: true,
        subjectId: true, phone: true, phoneVerifiedAt: true, email: true,
        createdAt: true, _count: { select: { children: true } },
      },
    }));
  }

  function listAppointments(context, input = {}) {
    return query(context, (transaction) => transaction.appointment.findMany({
      where: {
        organizationId: context.organizationId,
        ...(input.status ? { status: input.status } : {}),
        ...(context.role === 'CAREGIVER' ? {
          child: {
            caregivers: {
              some: { caregiver: { subjectId: context.actorSubjectId } },
            },
          },
        } : {}),
      },
      take: boundedLimit(input.limit),
      orderBy: { scheduledFor: 'asc' },
      select: {
        id: true, childId: true, facilityId: true, kind: true, scheduledFor: true,
        status: true, notes: true, createdAt: true,
        child: { select: { medfinetId: true, firstName: true, lastName: true } },
        facility: { select: { name: true, code: true } },
        caregiverResponses: {
          ...(context.role === 'CAREGIVER'
            ? { where: { caregiver: { subjectId: context.actorSubjectId } } }
            : {}),
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            response: true,
            status: true,
            preferredStart: true,
            preferredEnd: true,
            createdAt: true,
          },
        },
      },
    }));
  }

  function listEmergencyAccess(context, input = {}) {
    return query(context, (transaction) => transaction.emergencyAccess.findMany({
      where: {
        organizationId: context.organizationId,
        ...(input.reviewStatus ? { reviewStatus: input.reviewStatus } : {}),
      },
      take: boundedLimit(input.limit),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, childId: true, actorSubjectId: true, reasonCode: true,
        justification: true, status: true, reviewStatus: true, activatedAt: true,
        expiresAt: true, reviewedAt: true, reviewNotes: true,
        child: { select: { medfinetId: true, firstName: true, lastName: true } },
      },
    }));
  }

  function listClimateEvents(context, input = {}) {
    return query(context, (transaction) => transaction.climateEvent.findMany({
      where: {
        organizationId: context.organizationId,
        ...(input.status ? { status: input.status } : {}),
      },
      take: boundedLimit(input.limit),
      orderBy: { startsAt: 'desc' },
      include: { affectedAreas: { orderBy: { administrativeAreaCode: 'asc' } } },
    }));
  }

  function listWorklists(context, input = {}) {
    return query(context, (transaction) => transaction.beneficiaryWorklist.findMany({
      where: {
        organizationId: context.organizationId,
        ...(input.status ? { status: input.status } : {}),
      },
      take: boundedLimit(input.limit),
      orderBy: { createdAt: 'desc' },
      include: {
        climateEvent: { select: { id: true, name: true, eventType: true } },
        programme: { select: { id: true, name: true, code: true } },
        _count: { select: { entries: true } },
      },
    }));
  }

  function getWorklist(context, worklistId) {
    return query(context, async (transaction) => {
      const record = await transaction.beneficiaryWorklist.findFirst({
        where: { id: worklistId, organizationId: context.organizationId },
        include: {
          climateEvent: { select: { id: true, name: true, eventType: true } },
          programme: { select: { id: true, name: true, code: true } },
          entries: {
            take: 100,
            orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
            include: {
              child: { select: { id: true, medfinetId: true, firstName: true, lastName: true } },
              deliveries: { orderBy: { deliveredAt: 'desc' } },
              referrals: { orderBy: { openedAt: 'desc' } },
            },
          },
        },
      });
      if (!record) throw new DomainError(404, 'WORKLIST_NOT_FOUND', 'Worklist not found');
      return record;
    });
  }

  function listDevices(context, input = {}) {
    return query(context, (transaction) => transaction.fieldDevice.findMany({
      where: {
        organizationId: context.organizationId,
        ...(input.status ? { status: input.status } : {}),
      },
      take: boundedLimit(input.limit),
      orderBy: { registeredAt: 'desc' },
      select: {
        id: true, subjectId: true, displayName: true, platform: true, appVersion: true,
        nfcProvisioningEnabled: true, status: true, registeredAt: true, lastSeenAt: true,
      },
    }));
  }

  async function listRewardAccounts(context, input = {}) {
    const records = await query(context, (transaction) => transaction.rewardAccount.findMany({
      where: { organizationId: context.organizationId },
      take: boundedLimit(input.limit),
      orderBy: { updatedAt: 'desc' },
      include: { caregiver: { select: { firstName: true, lastName: true } } },
    }));
    return records.map((record) => ({
      ...record,
      balance: record.balance.toString(),
      reservedBalance: record.reservedBalance.toString(),
    }));
  }

  async function listRewardRedemptions(context, input = {}) {
    const records = await query(context, (transaction) => transaction.rewardRedemption.findMany({
      where: { organizationId: context.organizationId },
      take: boundedLimit(input.limit),
      orderBy: { redeemedAt: 'desc' },
      include: { merchant: { select: { name: true, code: true } } },
    }));
    return records.map((record) => ({ ...record, amount: record.amount.toString() }));
  }

  return {
    getWorklist,
    listAppointments,
    listCaregivers,
    listClimateEvents,
    listDevices,
    listEmergencyAccess,
    listRewardAccounts,
    listRewardRedemptions,
    listWorklists,
  };
}

module.exports = { boundedLimit, createOperationsQueryService };
