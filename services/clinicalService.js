const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const {
  ALERT_SEVERITIES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  boundedInteger,
  timestamp,
  audit,
} = require('./clinicalValidation');
const {
  createClinicalTimelineService,
} = require('./clinicalTimelineService');
const { assertResourceScope } = require('./resourceScopeService');

function createClinicalService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const timelineService = createClinicalTimelineService(database);

  async function requireChild(transaction, context, childId) {
    const child = await transaction.child.findFirst({
      where: { id: childId, organizationId: context.organizationId, status: 'ACTIVE' },
      select: { id: true, medfinetId: true },
    });
    if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
    return child;
  }

  async function recordImmunization(context, childId, input) {
    const data = {
      organizationId: context.organizationId,
      childId,
      vaccineCode: requiredText(input.vaccineCode, 'vaccineCode', 60).toUpperCase(),
      doseNumber: boundedInteger(input.doseNumber, 'doseNumber', { max: 20 }),
      administeredAt: timestamp(input.administeredAt, 'administeredAt', { future: false }),
      administeringSubjectId: context.actorSubjectId,
      ...(input.facilityId ? { facilityId: input.facilityId } : {}),
      ...(input.programmeId ? { programmeId: input.programmeId } : {}),
      ...(input.lotNumber ? { lotNumber: requiredText(input.lotNumber, 'lotNumber', 100) } : {}),
      ...(input.route ? { route: requiredText(input.route, 'route', 80) } : {}),
      ...(input.site ? { site: requiredText(input.site, 'site', 80) } : {}),
      ...(input.notes ? { notes: requiredText(input.notes, 'notes', 1000) } : {}),
      ...(input.sourceOperationId
        ? { sourceOperationId: requiredText(input.sourceOperationId, 'sourceOperationId', 120) }
        : {}),
    };
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      if (data.sourceOperationId) {
        const replay = await transaction.immunizationRecord.findUnique({
          where: {
            organizationId_sourceOperationId: {
              organizationId: context.organizationId,
              sourceOperationId: data.sourceOperationId,
            },
          },
        });
        if (replay) {
          if (replay.childId !== childId) {
            throw new DomainError(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'sourceOperationId was already used for another child'
            );
          }
          return replay;
        }
      }
      await assertResourceScope(transaction, context, {
        facilityId: data.facilityId,
        programmeId: data.programmeId,
      });
      await requireChild(transaction, context, childId);
      const record = await transaction.immunizationRecord.create({ data });
      await transaction.auditEvent.create({ data: audit(context, 'immunization.recorded', 'immunization', record.id, { childId }) });
      return record;
    });
  }

  async function recordGrowth(context, childId, input) {
    const data = {
      organizationId: context.organizationId,
      childId,
      measuredAt: timestamp(input.measuredAt, 'measuredAt', { future: false }),
      recordedBySubjectId: context.actorSubjectId,
      vitaminAAdministered: input.vitaminAAdministered === true,
      ...(input.facilityId ? { facilityId: input.facilityId } : {}),
      ...(input.weightGrams != null ? { weightGrams: boundedInteger(input.weightGrams, 'weightGrams', { max: 300000 }) } : {}),
      ...(input.heightMillimeters != null ? { heightMillimeters: boundedInteger(input.heightMillimeters, 'heightMillimeters', { max: 2500 }) } : {}),
      ...(input.muacMillimeters != null ? { muacMillimeters: boundedInteger(input.muacMillimeters, 'muacMillimeters', { max: 1000 }) } : {}),
      oedemaPresent: input.oedemaPresent === true,
      ...(input.notes ? { notes: requiredText(input.notes, 'notes', 1000) } : {}),
      ...(input.sourceOperationId
        ? { sourceOperationId: requiredText(input.sourceOperationId, 'sourceOperationId', 120) }
        : {}),
    };
    if (data.weightGrams == null && data.heightMillimeters == null && data.muacMillimeters == null && !data.vitaminAAdministered) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'At least one measurement or Vitamin A administration is required');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      if (data.sourceOperationId) {
        const replay = await transaction.growthMeasurement.findUnique({
          where: {
            organizationId_sourceOperationId: {
              organizationId: context.organizationId,
              sourceOperationId: data.sourceOperationId,
            },
          },
        });
        if (replay) {
          if (replay.childId !== childId) {
            throw new DomainError(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'sourceOperationId was already used for another child'
            );
          }
          return replay;
        }
      }
      await assertResourceScope(transaction, context, {
        facilityId: data.facilityId,
      });
      await requireChild(transaction, context, childId);
      const record = await transaction.growthMeasurement.create({ data });
      await transaction.auditEvent.create({ data: audit(context, 'growth.recorded', 'growth-measurement', record.id, { childId }) });
      return record;
    });
  }

  async function createAlert(context, childId, input) {
    if (!ALERT_SEVERITIES.has(input.severity)) throw new DomainError(400, 'VALIDATION_ERROR', 'severity is unsupported');
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await requireChild(transaction, context, childId);
      const alert = await transaction.clinicalAlert.create({ data: {
        organizationId: context.organizationId, childId,
        category: requiredText(input.category, 'category', 80), severity: input.severity,
        summary: requiredText(input.summary, 'summary', 500),
        emergencyVisible: input.emergencyVisible === true,
        createdBySubjectId: context.actorSubjectId,
      } });
      await transaction.auditEvent.create({ data: audit(context, 'clinical-alert.created', 'clinical-alert', alert.id, { childId }) });
      return alert;
    });
  }

  async function scheduleAppointment(context, childId, input) {
    const data = {
      organizationId: context.organizationId,
      childId,
      kind: requiredText(input.kind, 'kind', 100),
      scheduledFor: timestamp(input.scheduledFor, 'scheduledFor'),
      createdBySubjectId: context.actorSubjectId,
      ...(input.facilityId ? { facilityId: requiredText(input.facilityId, 'facilityId', 100) } : {}),
      ...(input.notes ? { notes: requiredText(input.notes, 'notes', 1000) } : {}),
      ...(input.sourceOperationId
        ? { sourceOperationId: requiredText(input.sourceOperationId, 'sourceOperationId', 120) }
        : {}),
    };
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      if (data.sourceOperationId) {
        const replay = await transaction.appointment.findUnique({
          where: {
            organizationId_sourceOperationId: {
              organizationId: context.organizationId,
              sourceOperationId: data.sourceOperationId,
            },
          },
        });
        if (replay) {
          if (replay.childId !== childId) {
            throw new DomainError(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'sourceOperationId was already used for another child'
            );
          }
          return replay;
        }
      }
      await assertResourceScope(transaction, context, {
        facilityId: data.facilityId,
      });
      await requireChild(transaction, context, childId);
      const appointment = await transaction.appointment.create({ data });
      await Promise.all([
        transaction.auditEvent.create({
          data: audit(context, 'appointment.scheduled', 'appointment', appointment.id, { childId }),
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'APPOINTMENT_SCHEDULED',
            aggregateType: 'appointment',
            aggregateId: appointment.id,
            idempotencyKey: `appointment:${appointment.id}:scheduled-notification`,
            payload: { appointmentId: appointment.id },
          },
        }),
      ]);
      return appointment;
    });
  }

  async function updateAppointmentStatus(context, appointmentId, input) {
    if (!APPOINTMENT_STATUSES.has(input.status) || input.status === 'SCHEDULED') {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'status must be COMPLETED, CANCELLED, or MISSED'
      );
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.appointment.findFirst({
        where: { id: appointmentId, organizationId: context.organizationId },
      });
      if (!existing) throw new DomainError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
      if (!APPOINTMENT_TRANSITIONS[existing.status].has(input.status)) {
        throw new DomainError(
          409,
          'INVALID_APPOINTMENT_TRANSITION',
          `Appointment cannot transition from ${existing.status} to ${input.status}`
        );
      }
      const appointment = await transaction.appointment.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          ...(input.notes ? { notes: requiredText(input.notes, 'notes', 1000) } : {}),
        },
      });
      await Promise.all([
        transaction.auditEvent.create({
          data: audit(context, 'appointment.status-changed', 'appointment', appointment.id, {
            from: existing.status,
            to: appointment.status,
            childId: appointment.childId,
          }),
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'APPOINTMENT_STATUS_CHANGED',
            aggregateType: 'appointment',
            aggregateId: appointment.id,
            idempotencyKey: `appointment:${appointment.id}:status:${appointment.status}:notification`,
            payload: { appointmentId: appointment.id },
          },
        }),
      ]);
      return appointment;
    });
  }

  return {
    recordImmunization,
    recordGrowth,
    createAlert,
    scheduleAppointment,
    updateAppointmentStatus,
    getClinicalTimeline: timelineService.get,
  };
}

module.exports = { createClinicalService, boundedInteger, timestamp };
