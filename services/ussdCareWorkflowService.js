const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

function actor(context) {
  return `ussd:${context.sessionId}`;
}

function audit(context, action, entityType, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: actor(context),
    action,
    entityType,
    entityId,
    purpose: 'caregiver-ussd',
    ...(metadata ? { metadata } : {}),
  };
}

function caregiverChildFilter(context) {
  return {
    organizationId: context.organizationId,
    status: 'ACTIVE',
    caregivers: { some: { caregiverId: context.caregiverId } },
  };
}

function timestamp(value, name) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.valueOf())) {
    throw new DomainError(400, 'USSD_DATE_INVALID', `${name} is invalid`);
  }
  return parsed;
}

function createUssdCareWorkflowService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function nextAppointment(context, { vaccinationOnly = false } = {}) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => (
      transaction.appointment.findFirst({
        where: {
          organizationId: context.organizationId,
          status: 'SCHEDULED',
          scheduledFor: { gte: now() },
          ...(vaccinationOnly ? {
            OR: [
              { kind: { contains: 'vacc', mode: 'insensitive' } },
              { kind: { contains: 'immun', mode: 'insensitive' } },
            ],
          } : {}),
          child: caregiverChildFilter(context),
        },
        select: {
          id: true,
          childId: true,
          kind: true,
          scheduledFor: true,
          facility: {
            select: { id: true, name: true, address: true, phone: true, openingHours: true },
          },
        },
        orderBy: { scheduledFor: 'asc' },
      })
    ));
  }

  async function respondToAppointment(context, appointmentId, input) {
    const decision = input.decision;
    if (!['CONFIRMED', 'RESCHEDULE_REQUESTED'].includes(decision)) {
      throw new DomainError(400, 'USSD_APPOINTMENT_DECISION_INVALID', 'Appointment decision is invalid');
    }
    const preferredStart = decision === 'RESCHEDULE_REQUESTED'
      ? timestamp(input.preferredStart, 'preferredStart')
      : null;
    const preferredEnd = decision === 'RESCHEDULE_REQUESTED'
      ? timestamp(input.preferredEnd, 'preferredEnd')
      : null;
    if (preferredStart && (preferredStart <= now() || preferredEnd <= preferredStart)) {
      throw new DomainError(400, 'USSD_RESCHEDULE_WINDOW_INVALID', 'Preferred appointment window is invalid');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.appointmentCaregiverResponse.findUnique({
        where: { sourceSessionId: context.sessionId },
      });
      if (replay) {
        if (replay.organizationId !== context.organizationId
          || replay.caregiverId !== context.caregiverId
          || replay.appointmentId !== appointmentId
          || replay.response !== decision) {
          throw new DomainError(409, 'USSD_IDEMPOTENCY_CONFLICT', 'Session action does not match its recorded appointment response');
        }
        return replay;
      }
      const appointment = await transaction.appointment.findFirst({
        where: {
          id: appointmentId,
          organizationId: context.organizationId,
          status: 'SCHEDULED',
          child: caregiverChildFilter(context),
        },
        select: { id: true, childId: true },
      });
      if (!appointment) throw new DomainError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
      const response = await transaction.appointmentCaregiverResponse.create({
        data: {
          organizationId: context.organizationId,
          appointmentId: appointment.id,
          childId: appointment.childId,
          caregiverId: context.caregiverId,
          response: decision,
          ...(preferredStart ? { preferredStart, preferredEnd } : {}),
          status: decision === 'CONFIRMED' ? 'COMPLETED' : 'PENDING',
          sourceSessionId: context.sessionId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, context.channel === 'WEB'
          ? 'appointment.caregiver-response-recorded'
          : 'ussd.appointment-response-recorded', 'appointment', appointment.id, {
          decision,
        }),
      });
      return response;
    });
  }

  async function requestCallback(context, category, childId = null) {
    const allowed = [
      'VACCINATION', 'NUTRITION', 'EMERGENCY', 'CARD_PROBLEM', 'GENERAL', 'REWARDS',
    ];
    if (!allowed.includes(category)) {
      throw new DomainError(400, 'USSD_CALLBACK_CATEGORY_INVALID', 'Callback category is invalid');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.ussdCallbackRequest.findUnique({
        where: { sourceSessionId: context.sessionId },
      });
      if (replay) {
        if (replay.organizationId !== context.organizationId
          || replay.caregiverId !== context.caregiverId || replay.category !== category) {
          throw new DomainError(409, 'USSD_IDEMPOTENCY_CONFLICT', 'Session action does not match its recorded callback request');
        }
        return replay;
      }
      if (childId) {
        const child = await transaction.child.findFirst({
          where: { id: childId, ...caregiverChildFilter(context) },
          select: { id: true },
        });
        if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Linked child not found');
      }
      const request = await transaction.ussdCallbackRequest.create({
        data: {
          organizationId: context.organizationId,
          caregiverId: context.caregiverId,
          ...(childId ? { childId } : {}),
          category,
          priority: category === 'EMERGENCY' ? 'CRITICAL' : 'LOW',
          sourceSessionId: context.sessionId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'ussd.callback-requested', 'ussd-callback-request', request.id, {
          category,
        }),
      });
      return request;
    });
  }

  async function registerProgrammeInterest(context, input) {
    const categories = ['VACCINATION', 'NUTRITION', 'CLIMATE_EMERGENCY', 'COMMUNITY_OUTREACH'];
    if (!categories.includes(input.category)) {
      throw new DomainError(400, 'USSD_PROGRAMME_CATEGORY_INVALID', 'Programme category is invalid');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.programmeInterest.findUnique({
        where: { sourceSessionId: context.sessionId },
      });
      if (replay) {
        if (replay.organizationId !== context.organizationId
          || replay.caregiverId !== context.caregiverId || replay.category !== input.category) {
          throw new DomainError(409, 'USSD_IDEMPOTENCY_CONFLICT', 'Session action does not match its recorded programme interest');
        }
        return replay;
      }
      if (input.childId) {
        const child = await transaction.child.findFirst({
          where: { id: input.childId, ...caregiverChildFilter(context) },
          select: { id: true },
        });
        if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Linked child not found');
      }
      if (input.programmeId) {
        const programme = await transaction.programme.findFirst({
          where: { id: input.programmeId, organizationId: context.organizationId, isActive: true },
          select: { id: true },
        });
        if (!programme) throw new DomainError(404, 'PROGRAMME_NOT_FOUND', 'Programme not found');
      }
      const interest = await transaction.programmeInterest.create({
        data: {
          organizationId: context.organizationId,
          caregiverId: context.caregiverId,
          category: input.category,
          ...(input.childId ? { childId: input.childId } : {}),
          ...(input.programmeId ? { programmeId: input.programmeId } : {}),
          ...(input.administrativeArea
            ? { administrativeArea: String(input.administrativeArea).slice(0, 120) }
            : {}),
          sourceSessionId: context.sessionId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'ussd.programme-interest-recorded', 'programme-interest', interest.id, {
          category: input.category,
        }),
      });
      return interest;
    });
  }

  async function latestUnconfirmedDelivery(context) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => (
      transaction.serviceDelivery.findFirst({
        where: {
          organizationId: context.organizationId,
          child: caregiverChildFilter(context),
          confirmations: { none: { caregiverId: context.caregiverId } },
        },
        select: {
          id: true,
          childId: true,
          category: true,
          quantity: true,
          unit: true,
          deliveredAt: true,
        },
        orderBy: { deliveredAt: 'desc' },
      })
    ));
  }

  async function confirmDelivery(context, deliveryId, decision) {
    if (!['CONFIRMED', 'NOT_RECEIVED', 'DISPUTED'].includes(decision)) {
      throw new DomainError(400, 'USSD_DELIVERY_DECISION_INVALID', 'Delivery decision is invalid');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.serviceDeliveryConfirmation.findUnique({
        where: { sourceSessionId: context.sessionId },
      });
      if (replay) {
        if (replay.organizationId !== context.organizationId
          || replay.caregiverId !== context.caregiverId
          || replay.serviceDeliveryId !== deliveryId || replay.decision !== decision) {
          throw new DomainError(409, 'USSD_IDEMPOTENCY_CONFLICT', 'Session action does not match its recorded delivery response');
        }
        return replay;
      }
      const delivery = await transaction.serviceDelivery.findFirst({
        where: {
          id: deliveryId,
          organizationId: context.organizationId,
          child: caregiverChildFilter(context),
        },
        select: { id: true, childId: true },
      });
      if (!delivery) throw new DomainError(404, 'SERVICE_DELIVERY_NOT_FOUND', 'Service delivery not found');
      const confirmation = await transaction.serviceDeliveryConfirmation.create({
        data: {
          organizationId: context.organizationId,
          serviceDeliveryId: delivery.id,
          childId: delivery.childId,
          caregiverId: context.caregiverId,
          decision,
          status: decision === 'CONFIRMED' ? 'COMPLETED' : 'PENDING',
          sourceSessionId: context.sessionId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'ussd.service-delivery-response-recorded', 'service-delivery', delivery.id, {
          decision,
        }),
      });
      return confirmation;
    });
  }

  async function activeClimateNotice(context, administrativeAreaCode = null) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      let areaCodes = [];
      const requestedArea = String(administrativeAreaCode || '').trim().slice(0, 80);
      if (requestedArea) {
        areaCodes = [requestedArea];
      } else {
        const profiles = await transaction.climateProfile.findMany({
          where: {
            organizationId: context.organizationId,
            child: { caregivers: { some: { caregiverId: context.caregiverId } } },
          },
          select: { administrativeAreaCode: true },
          distinct: ['administrativeAreaCode'],
          take: 20,
        });
        areaCodes = profiles.map((profile) => profile.administrativeAreaCode);
      }
      if (!areaCodes.length) return null;
      const event = await transaction.climateEvent.findFirst({
        where: {
          organizationId: context.organizationId,
          status: 'ACTIVE',
          startsAt: { lte: now() },
          OR: [{ endsAt: null }, { endsAt: { gt: now() } }],
          affectedAreas: { some: { administrativeAreaCode: { in: areaCodes } } },
        },
        select: { id: true, name: true, eventType: true, severity: true },
        orderBy: { startsAt: 'desc' },
      });
      return event ? { ...event, administrativeAreaCode: requestedArea || areaCodes[0] } : null;
    });
  }

  async function requestClimateAssistance(context, input) {
    const types = ['EVACUATION', 'HEALTH_SUPPORT', 'HOUSEHOLD_SAFETY', 'TEMPORARY_CLINIC', 'URGENT_NEED'];
    if (!types.includes(input.requestType)) {
      throw new DomainError(400, 'USSD_CLIMATE_REQUEST_INVALID', 'Climate request type is invalid');
    }
    const areaCode = String(input.administrativeAreaCode || '').trim().slice(0, 80);
    if (!areaCode) {
      throw new DomainError(400, 'USSD_CLIMATE_AREA_REQUIRED', 'Administrative area is required');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.climateAssistanceRequest.findUnique({
        where: { sourceSessionId: context.sessionId },
      });
      if (replay) {
        if (replay.organizationId !== context.organizationId
          || replay.caregiverId !== context.caregiverId
          || replay.requestType !== input.requestType
          || replay.administrativeAreaCode !== areaCode) {
          throw new DomainError(409, 'USSD_IDEMPOTENCY_CONFLICT', 'Session action does not match its recorded climate request');
        }
        return replay;
      }
      if (input.childId) {
        const child = await transaction.child.findFirst({
          where: { id: input.childId, ...caregiverChildFilter(context) },
          select: { id: true },
        });
        if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Linked child not found');
      }
      if (input.climateEventId) {
        const event = await transaction.climateEvent.findFirst({
          where: {
            id: input.climateEventId,
            organizationId: context.organizationId,
            status: 'ACTIVE',
            startsAt: { lte: now() },
            OR: [{ endsAt: null }, { endsAt: { gt: now() } }],
            affectedAreas: { some: { administrativeAreaCode: areaCode } },
          },
          select: { id: true },
        });
        if (!event) throw new DomainError(404, 'CLIMATE_EVENT_NOT_FOUND', 'Active climate event not found');
      }
      const request = await transaction.climateAssistanceRequest.create({
        data: {
          organizationId: context.organizationId,
          caregiverId: context.caregiverId,
          ...(input.childId ? { childId: input.childId } : {}),
          ...(input.climateEventId ? { climateEventId: input.climateEventId } : {}),
          administrativeAreaCode: areaCode,
          requestType: input.requestType,
          ...(input.requestType === 'HOUSEHOLD_SAFETY'
            ? { householdSafe: input.householdSafe === true }
            : {}),
          priority: ['EVACUATION', 'URGENT_NEED'].includes(input.requestType) ? 'CRITICAL' : 'HIGH',
          sourceSessionId: context.sessionId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'ussd.climate-assistance-requested', 'climate-assistance-request', request.id, {
          requestType: input.requestType,
        }),
      });
      return request;
    });
  }

  return {
    activeClimateNotice,
    confirmDelivery,
    latestUnconfirmedDelivery,
    nextAppointment,
    registerProgrammeInterest,
    requestCallback,
    requestClimateAssistance,
    respondToAppointment,
  };
}

module.exports = { createUssdCareWorkflowService };
