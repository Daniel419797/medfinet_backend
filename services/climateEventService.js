const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { timestamp } = require('./clinicalService');

const VULNERABILITY_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const EVENT_TRANSITIONS = {
  DRAFT: new Set(['ACTIVE', 'CANCELLED']),
  ACTIVE: new Set(['CLOSED', 'CANCELLED']),
  CLOSED: new Set(),
  CANCELLED: new Set(),
};

function enumValue(value, field, values) {
  if (!values.has(value)) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} is unsupported`);
  }
  return value;
}

function optionalTimestamp(value, field) {
  return value ? timestamp(value, field) : null;
}

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

function createClimateEventService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function upsertClimateProfile(context, childId, input) {
    const data = {
      organizationId: context.organizationId,
      childId,
      administrativeAreaCode: requiredText(
        input.administrativeAreaCode,
        'administrativeAreaCode',
        80
      ).toUpperCase(),
      vulnerability: enumValue(
        input.vulnerability,
        'vulnerability',
        VULNERABILITY_LEVELS
      ),
      displaced: input.displaced === true,
      ...(input.shelterCode
        ? { shelterCode: requiredText(input.shelterCode, 'shelterCode', 100) }
        : { shelterCode: null }),
      ...(input.hazardExposure ? { hazardExposure: input.hazardExposure } : {}),
      assessedAt: timestamp(input.assessedAt, 'assessedAt', { future: false }),
      assessedBySubjectId: context.actorSubjectId,
    };
    if (!data.displaced && data.shelterCode) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'shelterCode is permitted only when the child is displaced'
      );
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await transaction.child.findFirst({
        where: { id: childId, organizationId: context.organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
      const profile = await transaction.climateProfile.upsert({
        where: {
          childId_organizationId: {
            childId,
            organizationId: context.organizationId,
          },
        },
        create: data,
        update: {
          administrativeAreaCode: data.administrativeAreaCode,
          vulnerability: data.vulnerability,
          displaced: data.displaced,
          shelterCode: data.shelterCode,
          ...(input.hazardExposure ? { hazardExposure: input.hazardExposure } : {}),
          assessedAt: data.assessedAt,
          assessedBySubjectId: data.assessedBySubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'climate-profile.assessed', 'climate-profile', profile.id, {
          childId,
          administrativeAreaCode: profile.administrativeAreaCode,
          vulnerability: profile.vulnerability,
          displaced: profile.displaced,
        }),
      });
      return profile;
    });
  }

  async function createEvent(context, input) {
    const startsAt = timestamp(input.startsAt, 'startsAt');
    const endsAt = optionalTimestamp(input.endsAt, 'endsAt');
    if (endsAt && endsAt < startsAt) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'endsAt must not precede startsAt');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const event = await transaction.climateEvent.create({
        data: {
          organizationId: context.organizationId,
          name: requiredText(input.name, 'name', 160),
          eventType: requiredText(input.eventType, 'eventType', 80),
          severity: enumValue(input.severity, 'severity', VULNERABILITY_LEVELS),
          source: requiredText(input.source, 'source', 160),
          ...(input.externalReference
            ? {
              externalReference: requiredText(
                input.externalReference,
                'externalReference',
                160
              ),
            }
            : {}),
          startsAt,
          ...(endsAt ? { endsAt } : {}),
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'climate-event.created', 'climate-event', event.id),
      });
      return event;
    });
  }

  async function addAffectedArea(context, eventId, input) {
    const affectedFrom = timestamp(input.affectedFrom, 'affectedFrom');
    const affectedUntil = optionalTimestamp(input.affectedUntil, 'affectedUntil');
    if (affectedUntil && affectedUntil < affectedFrom) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'affectedUntil must not precede affectedFrom'
      );
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const event = await transaction.climateEvent.findFirst({
        where: {
          id: eventId,
          organizationId: context.organizationId,
          status: { in: ['DRAFT', 'ACTIVE'] },
        },
        select: { id: true },
      });
      if (!event) {
        throw new DomainError(
          404,
          'CLIMATE_EVENT_NOT_EDITABLE',
          'Draft or active climate event not found'
        );
      }
      const area = await transaction.affectedArea.create({
        data: {
          organizationId: context.organizationId,
          climateEventId: eventId,
          administrativeAreaCode: requiredText(
            input.administrativeAreaCode,
            'administrativeAreaCode',
            80
          ).toUpperCase(),
          administrativeAreaName: requiredText(
            input.administrativeAreaName,
            'administrativeAreaName',
            160
          ),
          severity: enumValue(input.severity, 'severity', VULNERABILITY_LEVELS),
          affectedFrom,
          ...(affectedUntil ? { affectedUntil } : {}),
          ...(input.sourceEvidence ? { sourceEvidence: input.sourceEvidence } : {}),
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'climate-event.area-added', 'affected-area', area.id, {
          climateEventId: eventId,
          administrativeAreaCode: area.administrativeAreaCode,
        }),
      });
      return area;
    });
  }

  async function transitionEvent(context, eventId, input) {
    const targetStatus = input.status;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.climateEvent.findFirst({
        where: { id: eventId, organizationId: context.organizationId },
      });
      if (!existing) {
        throw new DomainError(404, 'CLIMATE_EVENT_NOT_FOUND', 'Climate event not found');
      }
      if (!EVENT_TRANSITIONS[existing.status]?.has(targetStatus)) {
        throw new DomainError(
          409,
          'INVALID_CLIMATE_EVENT_TRANSITION',
          `Climate event cannot transition from ${existing.status} to ${targetStatus}`
        );
      }
      if (targetStatus === 'ACTIVE') {
        const affectedAreaCount = await transaction.affectedArea.count({
          where: { climateEventId: eventId, organizationId: context.organizationId },
        });
        if (affectedAreaCount === 0) {
          throw new DomainError(
            409,
            'AFFECTED_AREA_REQUIRED',
            'At least one affected area is required before activation'
          );
        }
      }
      const transitionTime = now();
      const event = await transaction.climateEvent.update({
        where: { id: eventId },
        data: {
          status: targetStatus,
          ...(targetStatus === 'ACTIVE' ? { activatedAt: transitionTime } : {}),
          ...(targetStatus === 'CLOSED'
            ? { closedAt: transitionTime, endsAt: existing.endsAt || transitionTime }
            : {}),
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'climate-event.status-changed', 'climate-event', event.id, {
          from: existing.status,
          to: targetStatus,
        }),
      });
      return event;
    });
  }

  return {
    upsertClimateProfile,
    createEvent,
    addAffectedArea,
    transitionEvent,
  };
}

module.exports = {
  createClimateEventService,
  EVENT_TRANSITIONS,
  VULNERABILITY_LEVELS,
};
