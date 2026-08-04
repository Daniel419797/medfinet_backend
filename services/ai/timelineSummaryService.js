const { DomainError } = require('../../utils/domainError');
const { withTenantTransaction } = require('../tenantContext');
const { createClinicalTimelineService } = require('../clinicalTimelineService');

const MAX_TIMELINE_ITEMS = 40;
const DATE_LOCALES = { en: 'en-NG', ha: 'ha-NG', yo: 'yo-NG', ig: 'ig-NG' };

function dateText(value, locale) {
  return new Intl.DateTimeFormat(DATE_LOCALES[locale] || DATE_LOCALES.en, {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(value));
}

function compactEvents(timeline, locale) {
  const events = [];
  for (const record of (timeline.immunizations || [])) {
    events.push(`vaccine ${record.vaccineCode} dose ${record.doseNumber} on ${dateText(record.administeredAt, locale)}`);
  }
  for (const record of (timeline.growth || [])) {
    const measures = [
      record.weightGrams ? `${(record.weightGrams / 1000).toFixed(1)}kg` : null,
      record.heightMillimeters ? `${(record.heightMillimeters / 10).toFixed(1)}cm` : null,
      record.muacMillimeters ? `MUAC ${record.muacMillimeters}mm` : null,
    ].filter(Boolean).join(', ');
    events.push(`growth measurement on ${dateText(record.measuredAt, locale)}${measures ? ` (${measures})` : ''}`);
  }
  for (const record of (timeline.alerts || [])) {
    events.push(`alert ${record.category} (${record.severity}): ${record.summary}`);
  }
  for (const record of (timeline.allergies || [])) {
    events.push(`allergy: ${record.substanceDisplay} (${record.severity})`);
  }
  for (const record of (timeline.appointments || [])) {
    events.push(`appointment ${dateText(record.scheduledFor, locale)} (${record.status})`);
  }
  return events.slice(0, MAX_TIMELINE_ITEMS);
}

function rulesSummary(timeline, events, locale) {
  const immunizations = timeline.immunizations || [];
  const alerts = (timeline.alerts || []).filter((alert) => alert.status === 'ACTIVE');
  const allergies = (timeline.allergies || []).filter((allergy) => allergy.status === 'ACTIVE');
  const nextAppointment = (timeline.appointments || [])
    .filter((appointment) => appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED')
    .sort((left, right) => new Date(left.scheduledFor) - new Date(right.scheduledFor))[0];
  const sentences = [];
  sentences.push(
    `${immunizations.length} vaccine dose${immunizations.length === 1 ? '' : 's'} recorded, ${events.length} total timeline events.`
  );
  if (alerts.length) {
    sentences.push(`${alerts.length} active clinical alert${alerts.length === 1 ? '' : 's'} require attention.`);
  }
  if (allergies.length) {
    sentences.push(`Active allergies: ${allergies.map((allergy) => allergy.substanceDisplay).join(', ')}.`);
  }
  const latestImmunization = immunizations[0];
  if (latestImmunization) {
    sentences.push(`Latest vaccine: ${latestImmunization.vaccineCode} dose ${latestImmunization.doseNumber} on ${dateText(latestImmunization.administeredAt, locale)}.`);
  }
  if (nextAppointment) {
    sentences.push(`Next appointment: ${dateText(nextAppointment.scheduledFor, locale)}.`);
  }
  return sentences.join(' ');
}

function createTimelineSummaryService(prismaClient, options = {}) {
  const database = prismaClient || require('../../utils/prisma').prisma;
  const ai = options.ai || (() => {
    const config = require('../../config');
    const { createAiClient } = require('./aiClient');
    return config.ai.enabled ? createAiClient(config.ai) : createAiClient({ provider: 'disabled' });
  })();
  const timeline = options.timeline || createClinicalTimelineService(database);

  async function summarize(context, input) {
    const locale = DATE_LOCALES[input.locale] ? input.locale : 'en';
    const loaded = await timeline.get(context, input.childId);
    const events = compactEvents(loaded, locale);
    if (!ai.enabled) {
      return {
        summary: rulesSummary(loaded, events, locale),
        nextSteps: [],
        eventCount: events.length,
        source: 'rules',
        model: null,
      };
    }
    const fallback = () => ({
      summary: rulesSummary(loaded, events, locale),
      nextSteps: [],
    });
    const { value: parsed, fellBack } = await ai.completeJson({
      system: [
        'You are a clinical summarizer for caregivers in the Medfinet programme.',
        'Summarize the child health timeline in plain language a parent understands.',
        'Only mention facts present in the timeline. Do not invent diagnoses or advice.',
        'If any active alert or allergy exists, mention it clearly.',
        'List up to 3 practical next steps (e.g. attend next appointment).',
      ].join('\n'),
      user: `Child health timeline events (${locale}):\n${events.join('\n') || 'No events recorded.'}`,
      schema: { summary: 'string', nextSteps: ['string'] },
      fallback,
      maxTokens: 400,
    });
    return {
      summary: parsed.summary,
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
      eventCount: events.length,
      source: fellBack ? 'rules' : 'ai',
      model: fellBack ? null : ai.model,
    };
  }

  return { summarize };
}

module.exports = {
  createTimelineSummaryService,
  compactEvents,
  rulesSummary,
  dateText,
};