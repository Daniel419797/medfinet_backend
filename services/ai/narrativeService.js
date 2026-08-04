const { DomainError } = require('../../utils/domainError');
const { createAnalyticsQueryService } = require('../analyticsQueryService');

function percent(valueBasisPoints) {
  if (valueBasisPoints === null || valueBasisPoints === undefined) return null;
  return (valueBasisPoints / 100).toFixed(1);
}

function rulesNarrative(metrics) {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const registered = byKey.get('registered_children')?.cohortSize ?? 0;
  const reach = percent(byKey.get('immunization_reach')?.valueBasisPoints);
  const vitaminA = percent(byKey.get('vitamin_a_reach')?.valueBasisPoints);
  const worklist = percent(byKey.get('eligible_worklist_completion')?.valueBasisPoints);
  const referrals = percent(byKey.get('referral_completion')?.valueBasisPoints);
  const deliveries = byKey.get('service_deliveries')?.cohortSize ?? 0;

  const sentences = [];
  sentences.push(
    `${registered} children were registered in the reporting period.`
  );
  if (reach !== null) {
    sentences.push(`Immunization reach was ${reach}% of registered children.`);
  }
  if (vitaminA !== null) {
    sentences.push(`Vitamin A reach was ${vitaminA}%.`);
  }
  if (worklist !== null) {
    sentences.push(`Eligible worklist completion was ${worklist}%.`);
  }
  if (referrals !== null) {
    sentences.push(`Referral completion was ${referrals}%.`);
  }
  sentences.push(`${deliveries} service deliveries were verified.`);
  return sentences.join(' ');
}

function createNarrativeService(options = {}) {
  const ai = options.ai || (() => {
    const config = require('../../config');
    const { createAiClient } = require('./aiClient');
    return config.ai.enabled ? createAiClient(config.ai) : createAiClient({ provider: 'disabled' });
  })();
  const query = options.query || createAnalyticsQueryService();

  async function generate(context) {
    const { run, metrics } = await query.latestInternal(context);
    if (!run) {
      throw new DomainError(
        404,
        'ANALYTICS_RUN_NOT_FOUND',
        'No completed analytics run is available for this organization'
      );
    }
    const compact = metrics.map((metric) => ({
      key: metric.key,
      valueBasisPoints: metric.valueBasisPoints,
      numerator: metric.numerator,
      denominator: metric.denominator,
      cohortSize: metric.cohortSize,
    }));
    if (!ai.enabled) {
      return {
        narrative: rulesNarrative(metrics),
        keyFindings: [],
        source: 'rules',
        model: null,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
      };
    }
    const fallback = () => ({ narrative: rulesNarrative(metrics), keyFindings: [] });
    const { value: parsed, fellBack } = await ai.completeJson({
      system: [
        'You are a programme reporting assistant for UNICEF-style health programmes.',
        'Write a factual narrative report for the metrics JSON provided. Do not invent numbers.',
        'Keep it under 200 words, plain language, suitable for donors and programme officers.',
        'Include a short list of key findings (max 3 strings), each one sentence.',
      ].join('\n'),
      user: `Reporting period: ${new Date(run.periodStart).toISOString().slice(0, 10)} to ${new Date(run.periodEnd).toISOString().slice(0, 10)}\nMetrics: ${JSON.stringify(compact)}`,
      schema: { narrative: 'string', keyFindings: ['string'] },
      fallback,
      maxTokens: 500,
    });
    return {
      narrative: parsed.narrative,
      keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
      source: fellBack ? 'rules' : 'ai',
      model: fellBack ? null : ai.model,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
    };
  }

  return { generate };
}

module.exports = { createNarrativeService, rulesNarrative, percent };