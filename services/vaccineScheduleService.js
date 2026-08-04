const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { assertResourceScope } = require('./resourceScopeService');

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_GRACE_DAYS = 30;

function integer(value, field, { minimum = 0, maximum = 36500 } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `${field} must be an integer between ${minimum} and ${maximum}`
    );
  }
  return value;
}

function normalizeRule(input) {
  const vaccineCode = requiredText(
    input.vaccineCode,
    'vaccineCode',
    60
  ).toUpperCase();
  if (!/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/.test(vaccineCode)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'vaccineCode is invalid');
  }
  const doseNumber = integer(input.doseNumber, 'doseNumber', {
    minimum: 1,
    maximum: 20,
  });
  const minimumAgeDays = integer(input.minimumAgeDays, 'minimumAgeDays');
  const recommendedAgeDays = integer(
    input.recommendedAgeDays,
    'recommendedAgeDays'
  );
  const maximumAgeDays = input.maximumAgeDays === null
    || input.maximumAgeDays === undefined
    ? null
    : integer(input.maximumAgeDays, 'maximumAgeDays');
  const minimumIntervalDays = input.minimumIntervalDays === null
    || input.minimumIntervalDays === undefined
    ? null
    : integer(input.minimumIntervalDays, 'minimumIntervalDays');
  if (
    recommendedAgeDays < minimumAgeDays
    || (maximumAgeDays !== null && maximumAgeDays < recommendedAgeDays)
    || (doseNumber === 1 && minimumIntervalDays !== null)
  ) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'Vaccine schedule ages and dose interval are inconsistent'
    );
  }
  return {
    programmeId: input.programmeId || null,
    vaccineCode,
    doseNumber,
    minimumAgeDays,
    recommendedAgeDays,
    maximumAgeDays,
    minimumIntervalDays,
  };
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function later(left, right) {
  return left > right ? left : right;
}

function recommendation(rule, dateOfBirth, immunizations, asOf) {
  const completed = immunizations.find((record) => (
    record.vaccineCode === rule.vaccineCode
    && record.doseNumber === rule.doseNumber
  ));
  const recommendedByAge = addDays(dateOfBirth, rule.recommendedAgeDays);
  if (completed) {
    return {
      vaccineCode: rule.vaccineCode,
      doseNumber: rule.doseNumber,
      status: 'COMPLETED',
      dueAt: recommendedByAge,
      completedAt: completed.administeredAt,
      ruleId: rule.id,
      ruleVersion: rule.version,
    };
  }
  const previous = rule.doseNumber === 1
    ? null
    : immunizations.find((record) => (
      record.vaccineCode === rule.vaccineCode
      && record.doseNumber === rule.doseNumber - 1
    ));
  if (rule.doseNumber > 1 && !previous) {
    return {
      vaccineCode: rule.vaccineCode,
      doseNumber: rule.doseNumber,
      status: 'BLOCKED_PREVIOUS_DOSE',
      dueAt: recommendedByAge,
      completedAt: null,
      ruleId: rule.id,
      ruleVersion: rule.version,
    };
  }
  const minimumByAge = addDays(dateOfBirth, rule.minimumAgeDays);
  const intervalDate = previous && rule.minimumIntervalDays !== null
    ? addDays(previous.administeredAt, rule.minimumIntervalDays)
    : minimumByAge;
  const eligibleAt = later(minimumByAge, intervalDate);
  const dueAt = later(recommendedByAge, intervalDate);
  let status;
  if (asOf < eligibleAt) status = 'NOT_ELIGIBLE';
  else if (asOf < dueAt) status = 'UPCOMING';
  else {
    const maximumAt = rule.maximumAgeDays === null
      ? null
      : addDays(dateOfBirth, rule.maximumAgeDays);
    status = (
      (maximumAt && asOf > maximumAt)
      || asOf > addDays(dueAt, OVERDUE_GRACE_DAYS)
    )
      ? 'OVERDUE'
      : 'DUE';
  }
  return {
    vaccineCode: rule.vaccineCode,
    doseNumber: rule.doseNumber,
    status,
    eligibleAt,
    dueAt,
    completedAt: null,
    ruleId: rule.id,
    ruleVersion: rule.version,
  };
}

function createVaccineScheduleService(
  prismaClient,
  { now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function createRule(context, input) {
    const normalized = normalizeRule(input);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      if (normalized.programmeId) {
        const programme = await transaction.programme.findFirst({
          where: {
            id: normalized.programmeId,
            organizationId: context.organizationId,
            isActive: true,
          },
          select: { id: true },
        });
        if (!programme) {
          throw new DomainError(
            404,
            'ACTIVE_PROGRAMME_NOT_FOUND',
            'Active programme not found'
          );
        }
      }
      const latest = await transaction.vaccineScheduleRule.findFirst({
        where: {
          organizationId: context.organizationId,
          programmeId: normalized.programmeId,
          vaccineCode: normalized.vaccineCode,
          doseNumber: normalized.doseNumber,
        },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const rule = await transaction.vaccineScheduleRule.create({
        data: {
          organizationId: context.organizationId,
          ...normalized,
          version: (latest?.version || 0) + 1,
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'vaccine-schedule-rule.created',
          entityType: 'vaccine-schedule-rule',
          entityId: rule.id,
          purpose: context.purpose,
          metadata: {
            vaccineCode: rule.vaccineCode,
            doseNumber: rule.doseNumber,
            version: rule.version,
          },
        },
      });
      return rule;
    });
  }

  async function activateRule(context, ruleId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const draft = await transaction.vaccineScheduleRule.findFirst({
        where: {
          id: ruleId,
          organizationId: context.organizationId,
          status: 'DRAFT',
        },
      });
      if (!draft) {
        throw new DomainError(
          404,
          'DRAFT_VACCINE_SCHEDULE_RULE_NOT_FOUND',
          'Draft vaccine schedule rule not found'
        );
      }
      if (draft.createdBySubjectId === context.actorSubjectId) {
        throw new DomainError(
          409,
          'VACCINE_SCHEDULE_MAKER_CHECKER_REQUIRED',
          'A different administrator must approve this schedule rule'
        );
      }
      const approvedAt = now();
      await transaction.vaccineScheduleRule.updateMany({
        where: {
          organizationId: context.organizationId,
          programmeId: draft.programmeId,
          vaccineCode: draft.vaccineCode,
          doseNumber: draft.doseNumber,
          status: 'ACTIVE',
        },
        data: { status: 'RETIRED' },
      });
      const active = await transaction.vaccineScheduleRule.update({
        where: { id: draft.id },
        data: {
          status: 'ACTIVE',
          approvedBySubjectId: context.actorSubjectId,
          approvedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'vaccine-schedule-rule.activated',
          entityType: 'vaccine-schedule-rule',
          entityId: active.id,
          purpose: context.purpose,
          metadata: {
            vaccineCode: active.vaccineCode,
            doseNumber: active.doseNumber,
            version: active.version,
          },
        },
      });
      return active;
    });
  }

  async function evaluate(context, childId, input = {}) {
    const asOf = input.asOf ? new Date(input.asOf) : now();
    if (Number.isNaN(asOf.valueOf()) || asOf > now()) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'asOf must be a current or past timestamp'
      );
    }
    const programmeId = input.programmeId || null;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await assertResourceScope(transaction, context, { programmeId });
      const child = await transaction.child.findFirst({
        where: {
          id: childId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          dateOfBirth: true,
          immunizations: {
            where: { status: { in: ['ACTIVE', 'AMENDED'] } },
            select: {
              vaccineCode: true,
              doseNumber: true,
              administeredAt: true,
            },
          },
        },
      });
      if (!child) {
        throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
      }
      const rules = await transaction.vaccineScheduleRule.findMany({
        where: {
          organizationId: context.organizationId,
          status: 'ACTIVE',
          ...(programmeId
            ? { OR: [{ programmeId: null }, { programmeId }] }
            : { programmeId: null }),
        },
        orderBy: [
          { vaccineCode: 'asc' },
          { doseNumber: 'asc' },
          { programmeId: 'asc' },
        ],
      });
      const selected = new Map();
      for (const rule of rules) {
        const key = `${rule.vaccineCode}:${rule.doseNumber}`;
        if (!selected.has(key) || rule.programmeId === programmeId) {
          selected.set(key, rule);
        }
      }
      const recommendations = [...selected.values()].map((rule) => (
        recommendation(
          rule,
          child.dateOfBirth,
          child.immunizations,
          asOf
        )
      ));
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'vaccine-schedule.evaluated',
          entityType: 'child',
          entityId: child.id,
          purpose: context.purpose,
          metadata: {
            programmeId,
            asOf: asOf.toISOString(),
            recommendationCount: recommendations.length,
          },
        },
      });
      return { childId: child.id, programmeId, asOf, recommendations };
    });
  }

  async function listRules(context, input = {}) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.vaccineScheduleRule.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.programmeId ? { programmeId: input.programmeId } : {}),
        },
        orderBy: [
          { vaccineCode: 'asc' },
          { doseNumber: 'asc' },
          { version: 'desc' },
        ],
        take: 500,
      })
    ));
  }

  async function emitVaccineDueEvents(context, outboxService) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const children = await transaction.child.findMany({
        where: { organizationId: context.organizationId, status: 'ACTIVE' },
        select: {
          id: true,
          preferredName: true,
          legalName: true,
          dateOfBirth: true,
          facilityId: true,
          immunizations: {
            where: { status: { in: ['ACTIVE', 'AMENDED'] } },
            select: {
              vaccineCode: true,
              doseNumber: true,
              administeredAt: true,
            },
          },
        },
      });
      const rules = await transaction.vaccineScheduleRule.findMany({
        where: { organizationId: context.organizationId, status: 'ACTIVE' },
        orderBy: [
          { vaccineCode: 'asc' },
          { doseNumber: 'asc' },
          { programmeId: 'asc' },
        ],
      });
      const selected = new Map();
      for (const rule of rules) {
        const key = `${rule.vaccineCode}:${rule.doseNumber}`;
        if (!selected.has(key)) {
          selected.set(key, rule);
        }
      }
      const asOf = now();
      let emitted = 0;
      for (const child of children) {
        const recs = [...selected.values()].map((rule) => (
          recommendation(rule, child.dateOfBirth, child.immunizations, asOf)
        ));
        for (const rec of recs) {
          if (rec.status === 'DUE' || rec.status === 'OVERDUE') {
            await outboxService.publish(context, {
              eventType: 'VACCINE_DUE',
              payload: {
                childId: child.id,
                vaccineCode: rec.vaccineCode,
                doseNumber: rec.doseNumber,
                dueAt: rec.dueAt.toISOString(),
                status: rec.status,
              },
            });
            emitted += 1;
          }
        }
      }
      return { childrenEvaluated: children.length, eventsEmitted: emitted };
    });
  }

  return { createRule, activateRule, evaluate, listRules, emitVaccineDueEvents };
}

module.exports = {
  createVaccineScheduleService,
  normalizeRule,
  recommendation,
  OVERDUE_GRACE_DAYS,
};
