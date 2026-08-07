const { DomainError } = require('../../utils/domainError');
const { withTenantTransaction } = require('../tenantContext');
const {
  DEFAULT_REWARD_ANOMALY_POLICY,
  resolveRewardPolicy,
  rulesAnomalies,
  mean,
  stdDev,
  zScore,
} = require('./rewardRiskScoring');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

// Retained for callers and focused tests that score a single prepared record.
function signalsFor(redemption, contextByRedeemer, referenceCounts, merchantStats, policyInput = {}) {
  const policy = resolveRewardPolicy(policyInput);
  const amount = Number(redemption.amount);
  const signals = [];
  const velocityEntry = contextByRedeemer.get(redemption.id)
    || contextByRedeemer.get(redemption.redeemedBySubjectId)
    || { count: 0 };
  const velocity = velocityEntry.count || 0;
  if (velocity >= policy.velocityThreshold) {
    signals.push(`high_redemption_velocity:${velocity}:window_hours=${policy.velocityWindowHours}`);
  }
  const reference = String(redemption.merchantReference || '').trim();
  const referenceCount = reference ? (referenceCounts.get(reference) || 1) : 1;
  if (referenceCount > 1) signals.push(`reused_merchant_reference:${referenceCount}`);
  const stats = merchantStats.get(redemption.id) || merchantStats.get(redemption.merchantId);
  let amountZScore = null;
  if (stats) {
    const deviation = stats.effectiveStdDev || stats.stdDev;
    amountZScore = zScore(amount, stats.mean, deviation);
    if (amountZScore >= policy.amountOutlierZThreshold) {
      signals.push(`amount_outlier:z=${amountZScore.toFixed(1)}:baseline=${stats.source || 'merchant'}`);
    }
  }
  const weights = {
    high_redemption_velocity: policy.velocityWeight,
    reused_merchant_reference: policy.reusedReferenceWeight,
    amount_outlier: policy.amountOutlierWeight,
  };
  const score = clamp01(signals.reduce(
    (total, signal) => total + weights[signal.split(':')[0]],
    0
  ));
  return {
    signals,
    score,
    suspicious: score >= policy.suspiciousScoreThreshold,
  };
}

function createRewardAnomalyService(prismaClient, options = {}) {
  const database = prismaClient || require('../../utils/prisma').prisma;
  const policy = resolveRewardPolicy(
    options.policy || require('../../config/riskScoring').reward
  );
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
    const historyLimit = Math.min(
      MAX_LIMIT,
      Math.max(limit, DEFAULT_LIMIT, policy.minimumOutlierPeers + 1)
    );
    const redemptions = await withTenantTransaction(database, context.organizationId, async (transaction) => (
      transaction.rewardRedemption.findMany({
        where: { organizationId: context.organizationId, status: 'COMPLETED' },
        orderBy: { redeemedAt: 'desc' },
        take: historyLimit,
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
      return {
        source: 'rules',
        model: null,
        policyVersion: policy.version,
        items: [],
        note: 'No completed redemptions found.',
      };
    }

    const ranked = rulesAnomalies(redemptions, policy)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
    if (!ai.enabled) {
      return { source: 'rules', model: null, policyVersion: policy.version, items: ranked };
    }

    const fallback = () => ({ anomalies: [] });
    const { value: reviewed, fellBack } = await ai.completeJson({
      system: [
        'Review the deterministic reward-redemption risk signals below.',
        'Treat each score as a prioritization aid, not proof of misconduct.',
        'Do not remove a flag already produced by the deterministic rules.',
        'Return one short reason for each record you flag.',
      ].join('\n'),
      user: `Redemption signals: ${JSON.stringify(ranked.slice(0, 15).map((item) => ({
        redemptionId: item.redemptionId,
        amount: item.amount,
        merchantId: item.merchantId,
        merchantReference: item.merchantReference,
        score: item.score,
        signals: item.signals,
        evidence: item.evidence,
      })))}`,
      schema: {
        anomalies: [{ redemptionId: 'string', suspicious: 'boolean', reason: 'string' }],
      },
      fallback,
      maxTokens: 400,
    });

    const byId = new Map(ranked.map((item) => [item.redemptionId, item]));
    const verdicts = new Map(
      (reviewed.anomalies || [])
        .filter((entry) => byId.has(entry.redemptionId))
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
    return {
      source: fellBack ? 'rules' : 'ai',
      model: fellBack ? null : ai.model,
      policyVersion: policy.version,
      items,
    };
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
  resolveRewardPolicy,
  DEFAULT_REWARD_ANOMALY_POLICY,
};
