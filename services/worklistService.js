const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { boundedInteger, timestamp } = require('./clinicalService');
const { requiredText } = require('./identityService');
const { normalizeAreaCodes, vulnerabilityRange } = require('./worklistCriteria');
const AUTHORIZATION_ROLES = new Set(['OWNER', 'ADMIN', 'EMERGENCY_COORDINATOR']);

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

function createWorklistService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function createWorklist(context, eventId, input) {
    const areaCodes = normalizeAreaCodes(input.administrativeAreaCodes);
    const minimumVulnerability = input.minimumVulnerability;
    vulnerabilityRange(minimumVulnerability);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const [event, programme, affectedAreaCount] = await Promise.all([
        transaction.climateEvent.findFirst({
          where: {
            id: eventId,
            organizationId: context.organizationId,
            status: 'ACTIVE',
          },
          select: { id: true },
        }),
        transaction.programme.findFirst({
          where: {
            id: input.programmeId,
            organizationId: context.organizationId,
            isActive: true,
          },
          select: { id: true },
        }),
        transaction.affectedArea.count({
          where: {
            climateEventId: eventId,
            organizationId: context.organizationId,
            administrativeAreaCode: { in: areaCodes },
          },
        }),
      ]);
      if (!event) {
        throw new DomainError(404, 'ACTIVE_CLIMATE_EVENT_NOT_FOUND', 'Active climate event not found');
      }
      if (!programme) {
        throw new DomainError(404, 'PROGRAMME_NOT_FOUND', 'Active programme not found');
      }
      if (affectedAreaCount !== areaCodes.length) {
        throw new DomainError(
          400,
          'AREA_OUTSIDE_EVENT',
          'Every worklist area must be part of the climate event'
        );
      }
      const worklist = await transaction.beneficiaryWorklist.create({
        data: {
          organizationId: context.organizationId,
          climateEventId: eventId,
          programmeId: programme.id,
          name: requiredText(input.name, 'name', 160),
          authorizationBasis: requiredText(
            input.authorizationBasis,
            'authorizationBasis',
            500
          ),
          criteria: {
            administrativeAreaCodes: areaCodes,
            minimumVulnerability,
            displacedOnly: input.displacedOnly === true,
          },
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'worklist.created', 'beneficiary-worklist', worklist.id, {
          climateEventId: eventId,
          programmeId: programme.id,
        }),
      });
      return worklist;
    });
  }

  async function authorizeWorklist(context, worklistId) {
    if (!AUTHORIZATION_ROLES.has(context.role)) {
      throw new DomainError(403, 'WORKLIST_AUTHORIZATION_DENIED', 'This role cannot authorize worklists');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const worklist = await transaction.beneficiaryWorklist.findFirst({
        where: {
          id: worklistId,
          organizationId: context.organizationId,
          status: 'DRAFT',
          generationComplete: true,
        },
      });
      if (!worklist) {
        throw new DomainError(
          409,
          'WORKLIST_NOT_AUTHORIZABLE',
          'A generated draft worklist is required'
        );
      }
      const entryCount = await transaction.worklistEntry.count({
        where: {
          organizationId: context.organizationId,
          worklistId,
          eligibility: 'ELIGIBLE',
        },
      });
      if (entryCount === 0) {
        throw new DomainError(409, 'EMPTY_WORKLIST', 'An empty worklist cannot be authorized');
      }
      const authorizedAt = now();
      const authorized = await transaction.beneficiaryWorklist.update({
        where: { id: worklist.id },
        data: {
          status: 'AUTHORIZED',
          authorizedAt,
          authorizedBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'worklist.authorized', 'beneficiary-worklist', worklist.id, {
          entryCount,
        }),
      });
      return authorized;
    });
  }

  async function requireOperationalEntry(transaction, context, entryId) {
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
    return entry;
  }

  async function recordDelivery(context, entryId, input) {
    const sourceOperationId = requiredText(
      input.sourceOperationId,
      'sourceOperationId',
      120
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.serviceDelivery.findUnique({
        where: {
          organizationId_sourceOperationId: {
            organizationId: context.organizationId,
            sourceOperationId,
          },
        },
      });
      if (replay) return { delivery: replay, idempotentReplay: true };
      const entry = await requireOperationalEntry(transaction, context, entryId);
      const delivery = await transaction.serviceDelivery.create({
        data: {
          organizationId: context.organizationId,
          worklistEntryId: entry.id,
          childId: entry.childId,
          category: requiredText(input.category, 'category', 100),
          quantity: boundedInteger(input.quantity, 'quantity', { max: 1_000_000 }),
          unit: requiredText(input.unit, 'unit', 40),
          deliveredAt: timestamp(input.deliveredAt, 'deliveredAt', { future: false }),
          deliveredBySubjectId: context.actorSubjectId,
          ...(input.notes ? { notes: requiredText(input.notes, 'notes', 1000) } : {}),
          sourceOperationId,
        },
      });
      const completedAt = now();
      await Promise.all([
        transaction.worklistEntry.update({
          where: { id: entry.id },
          data: { status: 'SERVED', completedAt },
        }),
        entry.worklist.status === 'AUTHORIZED'
          ? transaction.beneficiaryWorklist.update({
            where: { id: entry.worklist.id },
            data: { status: 'ACTIVE' },
          })
          : Promise.resolve(),
        transaction.auditEvent.create({
          data: audit(context, 'service-delivery.recorded', 'service-delivery', delivery.id, {
            childId: entry.childId,
            worklistId: entry.worklist.id,
          }),
        }),
      ]);
      return { delivery, idempotentReplay: false };
    });
  }

  return {
    createWorklist,
    authorizeWorklist,
    recordDelivery,
  };
}

module.exports = {
  createWorklistService,
  normalizeAreaCodes,
  vulnerabilityRange,
};
