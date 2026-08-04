const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

function jsonEvidence(value) {
  return JSON.parse(JSON.stringify(value));
}
const { requiredText } = require('./identityService');
const {
  ALERT_SEVERITIES,
  boundedInteger,
  timestamp,
  audit,
} = require('./clinicalValidation');

const ALLERGY_CRITICALITIES = new Set(['LOW', 'HIGH', 'UNABLE_TO_ASSESS']);
const ALLERGY_TERMINAL_STATUSES = new Set(['RESOLVED', 'ENTERED_IN_ERROR']);

function optionalText(value, field, maximum) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maximum);
}

async function requireChild(transaction, context, childId) {
  const child = await transaction.child.findFirst({
    where: {
      id: childId,
      organizationId: context.organizationId,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  if (!child) {
    throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
  }
}

function createClinicalLifecycleService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function recordAllergy(context, childId, input) {
    if (!ALERT_SEVERITIES.has(input.severity)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'severity is unsupported');
    }
    if (!ALLERGY_CRITICALITIES.has(input.criticality)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'criticality is unsupported');
    }
    const sourceOperationId = optionalText(
      input.sourceOperationId,
      'sourceOperationId',
      120
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      if (sourceOperationId) {
        const replay = await transaction.allergyRecord.findUnique({
          where: {
            organizationId_sourceOperationId: {
              organizationId: context.organizationId,
              sourceOperationId,
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
      await requireChild(transaction, context, childId);
      const allergy = await transaction.allergyRecord.create({
        data: {
          organizationId: context.organizationId,
          childId,
          substanceCode: optionalText(
            input.substanceCode,
            'substanceCode',
            100
          ),
          substanceDisplay: requiredText(
            input.substanceDisplay,
            'substanceDisplay',
            200
          ),
          reaction: optionalText(input.reaction, 'reaction', 500),
          severity: input.severity,
          criticality: input.criticality,
          sourceOperationId,
          recordedBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(
          context,
          'allergy.recorded',
          'allergy',
          allergy.id,
          { childId, severity: allergy.severity }
        ),
      });
      return allergy;
    });
  }

  async function resolveAllergy(context, allergyId, input) {
    if (!ALLERGY_TERMINAL_STATUSES.has(input.status)) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'status must be RESOLVED or ENTERED_IN_ERROR'
      );
    }
    const resolutionReason = requiredText(
      input.resolutionReason,
      'resolutionReason',
      1000
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const resolvedAt = new Date();
      const updated = await transaction.allergyRecord.updateMany({
        where: {
          id: allergyId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        data: {
          status: input.status,
          resolvedBySubjectId: context.actorSubjectId,
          resolvedAt,
          resolutionReason,
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'ALLERGY_NOT_RESOLVABLE',
          'Only an active allergy can be resolved'
        );
      }
      await transaction.auditEvent.create({
        data: audit(context, 'allergy.status-changed', 'allergy', allergyId, {
          status: input.status,
          resolutionReason,
        }),
      });
      return transaction.allergyRecord.findUnique({ where: { id: allergyId } });
    });
  }

  async function resolveAlert(context, alertId, input) {
    if (!['RESOLVED', 'ENTERED_IN_ERROR'].includes(input.status)) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'status must be RESOLVED or ENTERED_IN_ERROR'
      );
    }
    const reason = requiredText(input.reason, 'reason', 1000);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const resolvedAt = new Date();
      const updated = await transaction.clinicalAlert.updateMany({
        where: {
          id: alertId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        data: {
          status: input.status,
          resolvedBySubjectId: context.actorSubjectId,
          resolvedAt,
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'CLINICAL_ALERT_NOT_RESOLVABLE',
          'Only an active clinical alert can be resolved'
        );
      }
      await transaction.auditEvent.create({
        data: audit(
          context,
          'clinical-alert.status-changed',
          'clinical-alert',
          alertId,
          { status: input.status, reason }
        ),
      });
      return transaction.clinicalAlert.findUnique({ where: { id: alertId } });
    });
  }

  async function amendImmunization(context, recordId, input) {
    const reason = requiredText(input.reason, 'reason', 1000);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.immunizationRecord.findFirst({
        where: {
          id: recordId,
          organizationId: context.organizationId,
          status: { in: ['ACTIVE', 'AMENDED'] },
        },
      });
      if (!existing) {
        throw new DomainError(
          404,
          'IMMUNIZATION_NOT_AMENDABLE',
          'Active immunization record not found'
        );
      }
      const replacement = {
        vaccineCode: input.vaccineCode === undefined
          ? existing.vaccineCode
          : requiredText(input.vaccineCode, 'vaccineCode', 60).toUpperCase(),
        doseNumber: input.doseNumber === undefined
          ? existing.doseNumber
          : boundedInteger(input.doseNumber, 'doseNumber', { max: 20 }),
        administeredAt: input.administeredAt === undefined
          ? existing.administeredAt
          : timestamp(input.administeredAt, 'administeredAt', { future: false }),
        lotNumber: input.lotNumber === undefined
          ? existing.lotNumber
          : optionalText(input.lotNumber, 'lotNumber', 100),
        route: input.route === undefined
          ? existing.route
          : optionalText(input.route, 'route', 80),
        site: input.site === undefined
          ? existing.site
          : optionalText(input.site, 'site', 80),
        notes: input.notes === undefined
          ? existing.notes
          : optionalText(input.notes, 'notes', 1000),
      };
      const record = await transaction.immunizationRecord.update({
        where: { id: existing.id },
        data: { ...replacement, status: 'AMENDED' },
      });
      await Promise.all([
        transaction.clinicalAmendment.create({
          data: {
            organizationId: context.organizationId,
            immunizationId: existing.id,
            reason,
            previousData: jsonEvidence({
              vaccineCode: existing.vaccineCode,
              doseNumber: existing.doseNumber,
              administeredAt: existing.administeredAt,
              lotNumber: existing.lotNumber,
              route: existing.route,
              site: existing.site,
              notes: existing.notes,
            }),
            replacementData: jsonEvidence(replacement),
            amendedBySubjectId: context.actorSubjectId,
          },
        }),
        transaction.auditEvent.create({
          data: audit(
            context,
            'immunization.amended',
            'immunization',
            existing.id,
            { reason }
          ),
        }),
      ]);
      return record;
    });
  }

  async function amendGrowth(context, recordId, input) {
    const reason = requiredText(input.reason, 'reason', 1000);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.growthMeasurement.findFirst({
        where: {
          id: recordId,
          organizationId: context.organizationId,
          status: { in: ['ACTIVE', 'AMENDED'] },
        },
      });
      if (!existing) {
        throw new DomainError(
          404,
          'GROWTH_MEASUREMENT_NOT_AMENDABLE',
          'Active growth measurement not found'
        );
      }
      const integerOrNull = (value, field, maximum) => (
        value === null
          ? null
          : boundedInteger(value, field, { max: maximum })
      );
      const replacement = {
        measuredAt: input.measuredAt === undefined
          ? existing.measuredAt
          : timestamp(input.measuredAt, 'measuredAt', { future: false }),
        weightGrams: input.weightGrams === undefined
          ? existing.weightGrams
          : integerOrNull(input.weightGrams, 'weightGrams', 300000),
        heightMillimeters: input.heightMillimeters === undefined
          ? existing.heightMillimeters
          : integerOrNull(input.heightMillimeters, 'heightMillimeters', 2500),
        muacMillimeters: input.muacMillimeters === undefined
          ? existing.muacMillimeters
          : integerOrNull(input.muacMillimeters, 'muacMillimeters', 1000),
        vitaminAAdministered: input.vitaminAAdministered === undefined
          ? existing.vitaminAAdministered
          : input.vitaminAAdministered === true,
        oedemaPresent: input.oedemaPresent === undefined
          ? existing.oedemaPresent
          : input.oedemaPresent === true,
        notes: input.notes === undefined
          ? existing.notes
          : optionalText(input.notes, 'notes', 1000),
      };
      if (
        replacement.weightGrams === null
        && replacement.heightMillimeters === null
        && replacement.muacMillimeters === null
        && !replacement.vitaminAAdministered
      ) {
        throw new DomainError(
          400,
          'VALIDATION_ERROR',
          'At least one measurement or Vitamin A administration is required'
        );
      }
      const record = await transaction.growthMeasurement.update({
        where: { id: existing.id },
        data: { ...replacement, status: 'AMENDED' },
      });
      await Promise.all([
        transaction.clinicalAmendment.create({
          data: {
            organizationId: context.organizationId,
            growthMeasurementId: existing.id,
            reason,
            previousData: jsonEvidence({
              measuredAt: existing.measuredAt,
              weightGrams: existing.weightGrams,
              heightMillimeters: existing.heightMillimeters,
              muacMillimeters: existing.muacMillimeters,
              vitaminAAdministered: existing.vitaminAAdministered,
              oedemaPresent: existing.oedemaPresent,
              notes: existing.notes,
            }),
            replacementData: jsonEvidence(replacement),
            amendedBySubjectId: context.actorSubjectId,
          },
        }),
        transaction.auditEvent.create({
          data: audit(
            context,
            'growth-measurement.amended',
            'growth-measurement',
            existing.id,
            { reason }
          ),
        }),
      ]);
      return record;
    });
  }

  return {
    recordAllergy,
    resolveAllergy,
    resolveAlert,
    amendImmunization,
    amendGrowth,
  };
}

module.exports = {
  createClinicalLifecycleService,
  ALLERGY_CRITICALITIES,
};
