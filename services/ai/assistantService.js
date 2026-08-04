const { DomainError } = require('../../utils/domainError');
const { withTenantTransaction } = require('../tenantContext');
const { requiredText } = require('../identityService');
const { createVaccineScheduleService } = require('../vaccineScheduleService');

const MAX_QUESTION_LENGTH = 500;
const DATE_LOCALES = { en: 'en-NG', ha: 'ha-NG', yo: 'yo-NG', ig: 'ig-NG' };

function normalizeQuestion(input) {
  const question = requiredText(input.question, 'question', MAX_QUESTION_LENGTH);
  const locale = DATE_LOCALES[input.locale] ? input.locale : 'en';
  return { question, locale };
}

function dateText(value, locale) {
  return new Intl.DateTimeFormat(DATE_LOCALES[locale] || DATE_LOCALES.en, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function buildRecordContext(child, recommendations, nextAppointment, locale) {
  const lines = [];
  lines.push(`Child: ${child.firstName || 'Unnamed'}, born ${dateText(child.dateOfBirth, locale)}, age ${child.ageMonths} months`);
  if (child.sex) lines.push(`Sex: ${child.sex}`);
  const due = recommendations.filter((r) => r.status === 'DUE');
  const overdue = recommendations.filter((r) => r.status === 'OVERDUE');
  const upcoming = recommendations.filter((r) => r.status === 'UPCOMING');
  const completed = recommendations.filter((r) => r.status === 'COMPLETED');
  if (overdue.length) {
    lines.push(`Overdue vaccines: ${overdue.map((r) => `${r.vaccineCode} dose ${r.doseNumber} (due ${dateText(r.dueAt, locale)})`).join('; ')}`);
  }
  if (due.length) {
    lines.push(`Vaccines due now: ${due.map((r) => `${r.vaccineCode} dose ${r.doseNumber} (due ${dateText(r.dueAt, locale)})`).join('; ')}`);
  }
  if (upcoming.length) {
    lines.push(`Upcoming vaccines: ${upcoming.map((r) => `${r.vaccineCode} dose ${r.doseNumber} (due ${dateText(r.dueAt, locale)})`).join('; ')}`);
  }
  lines.push(`Vaccines completed: ${completed.length}`);
  if (nextAppointment) {
    lines.push(`Next appointment: ${dateText(nextAppointment.scheduledFor, locale)} at ${nextAppointment.facility?.name || 'facility'}`);
  }
  return lines.join('\n');
}

function rulesAnswer(recommendations, nextAppointment, locale) {
  const overdue = recommendations.filter((r) => r.status === 'OVERDUE');
  const due = recommendations.filter((r) => r.status === 'DUE');
  const upcoming = recommendations.filter((r) => r.status === 'UPCOMING');
  const parts = [];
  if (overdue.length) {
    parts.push(`Your child is overdue for ${overdue.map((r) => `${r.vaccineCode} dose ${r.doseNumber}`).join(', ')}. Visit a clinic as soon as possible.`);
  }
  if (due.length) {
    parts.push(`These vaccines are due now: ${due.map((r) => `${r.vaccineCode} dose ${r.doseNumber}`).join(', ')}.`);
  }
  if (upcoming.length) {
    parts.push(`Next vaccine due: ${upcoming[0].vaccineCode} dose ${upcoming[0].doseNumber} on ${dateText(upcoming[0].dueAt, locale)}.`);
  }
  if (!parts.length) parts.push('Your child is up to date on all scheduled vaccines.');
  if (nextAppointment) {
    parts.push(`Next appointment is ${dateText(nextAppointment.scheduledFor, locale)}.`);
  }
  return parts.join(' ');
}

function createAssistantService(prismaClient, options = {}) {
  const database = prismaClient || require('../../utils/prisma').prisma;
  const ai = options.ai || (() => {
    const config = require('../../config');
    const { createAiClient } = require('./aiClient');
    return config.ai.enabled ? createAiClient(config.ai) : createAiClient({ provider: 'disabled' });
  })();
  const schedule = options.schedule || createVaccineScheduleService(database);

  async function loadChild(transaction, context, childId) {
    const child = await transaction.child.findFirst({
      where: {
        id: childId,
        organizationId: context.organizationId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        firstName: true,
        dateOfBirth: true,
        sex: true,
        immunizations: {
          where: { status: { in: ['ACTIVE', 'AMENDED'] } },
          select: {
            vaccineCode: true,
            doseNumber: true,
            administeredAt: true,
          },
        },
        appointments: {
          where: { status: { in: ['SCHEDULED', 'CONFIRMED'] } },
          orderBy: { scheduledFor: 'asc' },
          take: 1,
          select: {
            scheduledFor: true,
            facility: { select: { name: true } },
          },
        },
      },
    });
    if (!child) {
      throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
    }
    const ageMonths = Math.max(0, Math.floor(
      (Date.now() - new Date(child.dateOfBirth).getTime()) / (30.44 * 24 * 60 * 60 * 1000)
    ));
    return { ...child, ageMonths, nextAppointment: child.appointments?.[0] || null };
  }

  async function ask(context, input) {
    const normalized = normalizeQuestion(input);
    const loaded = await withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await loadChild(transaction, context, input.childId);
      const evaluation = await schedule.evaluate(context, child.id);
      return { child, evaluation };
    });
    const recordContext = buildRecordContext(
      loaded.child,
      loaded.evaluation.recommendations,
      loaded.child.nextAppointment,
      normalized.locale
    );
    const urgent = loaded.evaluation.recommendations.some((r) => r.status === 'OVERDUE');

    if (!ai.enabled) {
      return {
        answer: rulesAnswer(
          loaded.evaluation.recommendations,
          loaded.child.nextAppointment,
          normalized.locale
        ),
        urgent,
        source: 'rules',
        model: null,
      };
    }

    const fallback = () => ({
      answer: rulesAnswer(
        loaded.evaluation.recommendations,
        loaded.child.nextAppointment,
        normalized.locale
      ),
      urgent,
    });

    const { value: parsed, fellBack } = await ai.completeJson({
      system: [
        'You are a friendly health assistant for parents in the Medfinet programme.',
        'Answer ONLY from the child record provided. Never invent vaccine codes, dates, or medical advice.',
        'If the record lacks information to answer, say so plainly.',
        'Use simple language a caregiver will understand. Keep the answer under 150 words.',
        'Never tell a parent to skip or delay vaccinations; direct them to a clinic.',
        'If the question suggests a medical emergency, set urgent to true.',
      ].join('\n'),
      user: `Child record:\n${recordContext}\n\nParent question: ${normalized.question}`,
      schema: { answer: 'string', urgent: 'boolean' },
      fallback,
      maxTokens: 300,
    });

    return {
      answer: parsed.answer,
      urgent: parsed.urgent === true || urgent,
      source: fellBack ? 'rules' : 'ai',
      model: fellBack ? null : ai.model,
    };
  }

  return { ask };
}

module.exports = { createAssistantService, buildRecordContext, rulesAnswer, normalizeQuestion };