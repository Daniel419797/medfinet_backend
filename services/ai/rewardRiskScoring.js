const { DomainError } = require('../../utils/domainError');

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_POLICY = Object.freeze({
  version: 'reward-risk-v1',
  velocityThreshold: 3,
  velocityWindowHours: 24,
  amountOutlierZThreshold: 2.5,
  minimumOutlierPeers: 5,
  merchantPriorSamples: 20,
  dispersionFloorRatio: 0.1,
  suspiciousScoreThreshold: 0.6,
  velocityWeight: 0.6,
  reusedReferenceWeight: 0.5,
  amountOutlierWeight: 0.5,
});

function bounded(value, fallback, field, min, max, integer = false) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} is outside its supported range`);
  }
  return parsed;
}

function resolveRewardPolicy(input = {}) {
  return Object.freeze({
    version: String(input.version || DEFAULT_POLICY.version),
    velocityThreshold: bounded(input.velocityThreshold, DEFAULT_POLICY.velocityThreshold, 'reward velocityThreshold', 2, 100, true),
    velocityWindowHours: bounded(input.velocityWindowHours, DEFAULT_POLICY.velocityWindowHours, 'reward velocityWindowHours', 1, 168),
    amountOutlierZThreshold: bounded(input.amountOutlierZThreshold, DEFAULT_POLICY.amountOutlierZThreshold, 'reward amountOutlierZThreshold', 1, 10),
    minimumOutlierPeers: bounded(input.minimumOutlierPeers, DEFAULT_POLICY.minimumOutlierPeers, 'reward minimumOutlierPeers', 2, 499, true),
    merchantPriorSamples: bounded(input.merchantPriorSamples, DEFAULT_POLICY.merchantPriorSamples, 'reward merchantPriorSamples', 1, 10000, true),
    dispersionFloorRatio: bounded(input.dispersionFloorRatio, DEFAULT_POLICY.dispersionFloorRatio, 'reward dispersionFloorRatio', 0.01, 1),
    suspiciousScoreThreshold: bounded(input.suspiciousScoreThreshold, DEFAULT_POLICY.suspiciousScoreThreshold, 'reward suspiciousScoreThreshold', 0.1, 1),
    velocityWeight: bounded(input.velocityWeight, DEFAULT_POLICY.velocityWeight, 'reward velocityWeight', 0, 1),
    reusedReferenceWeight: bounded(input.reusedReferenceWeight, DEFAULT_POLICY.reusedReferenceWeight, 'reward reusedReferenceWeight', 0, 1),
    amountOutlierWeight: bounded(input.amountOutlierWeight, DEFAULT_POLICY.amountOutlierWeight, 'reward amountOutlierWeight', 0, 1),
  });
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function zScore(value, average, deviation) {
  return deviation === 0 ? 0 : (value - average) / deviation;
}

function velocityCounts(redemptions, windowHours) {
  const groups = new Map();
  for (const item of redemptions) {
    const group = groups.get(item.redeemedBySubjectId) || [];
    group.push(item);
    groups.set(item.redeemedBySubjectId, group);
  }
  const counts = new Map();
  const windowMs = windowHours * HOUR_MS;
  for (const group of groups.values()) {
    for (const item of group) {
      const at = new Date(item.redeemedAt).getTime();
      counts.set(item.id, group.filter((candidate) => {
        const candidateAt = new Date(candidate.redeemedAt).getTime();
        return candidateAt <= at && candidateAt >= at - windowMs;
      }).length);
    }
  }
  return counts;
}

function baselineFor(redemption, redemptions, policy) {
  const organizationValues = redemptions
    .filter((candidate) => candidate.id !== redemption.id)
    .map((candidate) => Number(candidate.amount));
  if (organizationValues.length < policy.minimumOutlierPeers) return null;
  const merchantValues = redemptions
    .filter((candidate) => candidate.id !== redemption.id && candidate.merchantId === redemption.merchantId)
    .map((candidate) => Number(candidate.amount));
  const organizationMean = mean(organizationValues);
  const organizationDeviation = stdDev(organizationValues);
  let source = 'organization';
  let peerCount = organizationValues.length;
  let average = organizationMean;
  let deviation = organizationDeviation;
  if (merchantValues.length >= policy.minimumOutlierPeers) {
    source = 'merchant';
    peerCount = merchantValues.length;
    average = mean(merchantValues);
    deviation = stdDev(merchantValues);
  } else if (merchantValues.length) {
    source = 'blended';
    peerCount = merchantValues.length;
    const merchantMean = mean(merchantValues);
    const weight = merchantValues.length / (merchantValues.length + policy.merchantPriorSamples);
    average = (weight * merchantMean) + ((1 - weight) * organizationMean);
    deviation = Math.sqrt(
      (weight * (stdDev(merchantValues) ** 2))
      + ((1 - weight) * (organizationDeviation ** 2))
      + (weight * (1 - weight) * ((merchantMean - organizationMean) ** 2))
    );
  }
  const effectiveDeviation = Math.max(deviation, 1, Math.abs(average) * policy.dispersionFloorRatio);
  return { source, peerCount, average, effectiveDeviation };
}

function rulesAnomalies(redemptions, policyInput = {}) {
  const policy = resolveRewardPolicy(policyInput);
  const velocity = velocityCounts(redemptions, policy.velocityWindowHours);
  const references = new Map();
  for (const item of redemptions) {
    const reference = String(item.merchantReference || '').trim();
    if (reference) references.set(reference, (references.get(reference) || 0) + 1);
  }
  return redemptions.map((item) => {
    const signals = [];
    const count = velocity.get(item.id) || 0;
    if (count >= policy.velocityThreshold) {
      signals.push(`high_redemption_velocity:${count}:window_hours=${policy.velocityWindowHours}`);
    }
    const reference = String(item.merchantReference || '').trim();
    const referenceCount = reference ? (references.get(reference) || 1) : 1;
    if (referenceCount > 1) signals.push(`reused_merchant_reference:${referenceCount}`);
    const baseline = baselineFor(item, redemptions, policy);
    const amountZScore = baseline
      ? zScore(Number(item.amount), baseline.average, baseline.effectiveDeviation)
      : null;
    if (amountZScore !== null && amountZScore >= policy.amountOutlierZThreshold) {
      signals.push(`amount_outlier:z=${amountZScore.toFixed(1)}:baseline=${baseline.source}`);
    }
    const weights = {
      high_redemption_velocity: policy.velocityWeight,
      reused_merchant_reference: policy.reusedReferenceWeight,
      amount_outlier: policy.amountOutlierWeight,
    };
    const score = Math.min(1, signals.reduce((sum, signal) => sum + weights[signal.split(':')[0]], 0));
    return {
      redemptionId: item.id,
      amount: Number(item.amount),
      merchantId: item.merchantId,
      merchantReference: item.merchantReference,
      redeemedAt: item.redeemedAt,
      suspicious: score >= policy.suspiciousScoreThreshold,
      score,
      signals,
      evidence: {
        velocityCount: count,
        velocityWindowHours: policy.velocityWindowHours,
        merchantReferenceCount: referenceCount,
        amountZScore: amountZScore === null ? null : Math.round(amountZScore * 1000) / 1000,
        amountBaseline: baseline ? {
          source: baseline.source,
          peerCount: baseline.peerCount,
          mean: Math.round(baseline.average * 1000) / 1000,
          standardDeviation: Math.round(baseline.effectiveDeviation * 1000) / 1000,
        } : null,
      },
    };
  });
}

module.exports = {
  DEFAULT_REWARD_ANOMALY_POLICY: DEFAULT_POLICY,
  resolveRewardPolicy,
  rulesAnomalies,
  mean,
  stdDev,
  zScore,
};
