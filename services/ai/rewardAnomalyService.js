const { DomainError } = require('../../utils/domainError');
const { withTenantTransaction } = require('../tenantContext');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce(
    (total, value) => total + (value - average) ** 2,
    0
  ) / (values.length - 1);
  return Math.sqrt(variance);
}

function zScore(value, average, deviation) {
  if (deviation === 0) return 0;
  return (value - average) / deviation;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function signalsFor(redemption, contextByRedeemer, referenceCounts, merchantStats) {
  const amount = Number(redemption.amount);
  const signals = [];
  const velocity = contextByRedeemer.get(redemption.redeemedBySubjectId)?.count || 0;
  if (velocity >= 3) {
    signals.push(`high_redemption_velocity:${velocity}`);
  }
  const referenceCount = referenceCounts.get(redemption.merchantReference) || 1;
  if (referenceCount > 1) {
    signals.push(`reused_merchant_reference:${referenceCount}`);
  }
  const stats = merchantStats.get(redemption.merchantId);
  if (stats) {
    const z = zScore(amount, stats.mean, stats.stdDev);
    if (z >= 2.5) signals.push(`amount_outlier:z=${z.toFixed(1)}`);
  }
  const weight = {
    high_redemption_velocity: 0.6,
    reused_merchant_reference: 0.5,
    amount_outlier: 0.5,
  };
  const score = signals.length === 0
    ? 0
    : clamp01(signals.reduce((total, signal) => total + weight[signal.split(':')[0]], 0));
  return { signals, score, suspicious: score >= 0.6 };
}

function rulesAnomalies(redemptions) {
  const contextByRedeemer = new Map();
  for (const redemption of redemptions) {
    const entry = contextByRedeemer.get(redemption.redeemedBySubjectId) || { count: 0 };
    entry.count += 1;
    contextByRedeemer.set(redemption.redeemedBySubjectId, entry);
  }
  const referenceCounts = new Map();
  for (const redemption of redemptions) {
    referenceCounts.set(
      redemption.merchantReference,
      (referenceCounts.get(redemption.merchantReference) || 0) + 1
    );
  }
  const merchantStats = new Map();
  for (const redemption of redemptions) {
    const stats = merchantStats.get(redemption.merchantId) || { values: [] };
    stats.values.push(Number(redemption.amount));
    merchantStats.set(redemption.merchantId, stats);
  }
  for (const [merchantId, stats] of merchantStats) {
    merchantStats.set(merchantId, { mean: mean(stats.values), stdDev: stdDev(stats.values) });
  }
  return redemptions.map((redemption) => {
    const { signals, score, suspicious } = signalsFor(redemption, contextByRedeemer, referenceCounts, merchantStats);
    return {
      redemptionId: redemption.id,
      amount: Number(redemption.amount),
      merchantId: redemption.merchantId,
      merchantReference: redemption.merchantReference,
      redeemedAt: redemption.redeemedAt,
      suspicious,
      score,
      signals,
    };
  });
}

function createRewardAnomalyService(prismaClient, options = {}) {
  const database = prismaClient || require('../../utils/prisma').prisma;
  const ai = options.ai || (() => {
    const config = require('../../config');
    const { createAiClient } = require('./aiClient');
    return config.ai.enabled ? createAiClient(config.ai) : createAiClient({ provider: 'disabled' });
  })();

  async function detect(context, input = {}) {
    const limit = input.limit === undefined ? DEFAULT_LIMIT : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 500');
    }
    const redemptions = await withTenantTransaction(database, context.organizationId, async (transaction) => (
      transaction.rewardRedemption.findMany({
        where: { organizationId: context.organizationId, status: 'COMPLETED' },
        orderBy: { redeemedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          amount: true,
          merchantId: true,
          merchantReference: true,
          redeemedBySubjectId: true,
          redeemedAt: true,
        },
      })
    ));
    if (redemptions.length === 0) {
      return { source: 'rules', model: null, items: [], note: 'No completed redemptions found.' };
    }

    const ranked = rulesAnomalies(redemptions)
      .sort((left, right) => right.score - left.score);
    if (!ai.enabled) {
      return { source: 'rules', model: null, items: ranked };
    }

    const fallback = () => ({ anomalies: [] });
    const { value: reviewed, fellBack } = await ai.completeJson({
      system: [
        'You are a fraud analyst for a reward redemption ledger (Medfinet).',
        'Review the redemption signals below. Flag only genuinely suspicious patterns',
        '(for example rapid repeated redemptions by the same caregiver, reused merchant',
        'references, or amounts far above the merchant normal).',
        'Provide one short reason per flagged redemption.',
      ].join('\n'),
      user: `Redemption signals: ${JSON.stringify(ranked.slice(0, 15).map((item) => ({
        redemptionId: item.redemptionId,
        amount: item.amount,
        merchantId: item.merchantId,
        merchantReference: item.merchantReference,
        score: item.score,
        signals: item.signals,
      })))}`,
      schema: {
        anomalies: [{ redemptionId: 'string', suspicious: 'boolean', reason: 'string' }],
      },
      fallback,
      maxTokens: 400,
    });

    const byId = new Map(ranked.map((item) => [item.redemptionId, item]));
    const verdicts = new Map(
      (reviewed.anomalies || []).filter((entry) => byId.has(entry.redemptionId))
        .map((entry) => [entry.redemptionId, entry])
    );
    const items = ranked.map((item) => {
      const verdict = verdicts.get(item.redemptionId);
      if (!verdict) return item;
      return {
        ...item,
        suspicious: verdict.suspicious === true || item.suspicious,
        reason: verdict.reason || null,
      };
    });
    return { source: fellBack ? 'rules' : 'ai', model: fellBack ? null : ai.model, items };
  }

  return { detect };
}

module.exports = {
  createRewardAnomalyService,
  rulesAnomalies,
  signalsFor,
  zScore,
  mean,
  stdDev,
};