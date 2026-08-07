const { DomainError } = require('../utils/domainError');

const DAY_MS = 24 * 60 * 60 * 1000;
const PROFILE_BASE_SCORE = Object.freeze({ LOW: 15, MEDIUM: 40, HIGH: 65, CRITICAL: 85 });
const HAZARD_LEVEL_BONUS = Object.freeze({ LOW: 0, MEDIUM: 5, HIGH: 10, CRITICAL: 15 });
const DEFAULT_POLICY = Object.freeze({
  version: 'climate-worklist-risk-v1',
  displacedBonus: 10,
  staleAssessmentDays: 180,
  staleAssessmentBonus: 5,
  mediumThreshold: 40,
  highThreshold: 65,
  criticalThreshold: 85,
});

function bounded(value, fallback, field, min = 0, max = 100) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} is outside its supported range`);
  }
  return parsed;
}

function resolveClimateRiskPolicy(input = {}) {
  const policy = {
    version: String(input.version || DEFAULT_POLICY.version),
    displacedBonus: bounded(input.displacedBonus, DEFAULT_POLICY.displacedBonus, 'climate displacedBonus', 0, 50),
    staleAssessmentDays: bounded(input.staleAssessmentDays, DEFAULT_POLICY.staleAssessmentDays, 'climate staleAssessmentDays', 1, 3650),
    staleAssessmentBonus: bounded(input.staleAssessmentBonus, DEFAULT_POLICY.staleAssessmentBonus, 'climate staleAssessmentBonus', 0, 25),
    mediumThreshold: bounded(input.mediumThreshold, DEFAULT_POLICY.mediumThreshold, 'climate mediumThreshold'),
    highThreshold: bounded(input.highThreshold, DEFAULT_POLICY.highThreshold, 'climate highThreshold'),
    criticalThreshold: bounded(input.criticalThreshold, DEFAULT_POLICY.criticalThreshold, 'climate criticalThreshold'),
  };
  if (!Number.isInteger(policy.staleAssessmentDays)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'climate staleAssessmentDays must be an integer');
  }
  if (!(policy.mediumThreshold < policy.highThreshold && policy.highThreshold < policy.criticalThreshold)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'climate thresholds must increase from medium to high to critical');
  }
  return Object.freeze(policy);
}

function clamp(value) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function priorityForRiskScore(score, policyInput = {}) {
  const policy = resolveClimateRiskPolicy(policyInput);
  if (score >= policy.criticalThreshold) return 'CRITICAL';
  if (score >= policy.highThreshold) return 'HIGH';
  if (score >= policy.mediumThreshold) return 'MEDIUM';
  return 'LOW';
}

function hazardBonus(exposure) {
  if (!exposure || typeof exposure !== 'object' || Array.isArray(exposure)) return 0;
  const level = String(exposure.severity || exposure.level || '').toUpperCase();
  const levelPoints = HAZARD_LEVEL_BONUS[level] || 0;
  const rawScore = Number(exposure.riskScore);
  const scorePoints = Number.isFinite(rawScore) ? clamp(rawScore) * 0.15 : 0;
  const activePoints = Array.isArray(exposure.activeHazards)
    ? Math.min(10, exposure.activeHazards.length * 2)
    : 0;
  return Math.round(Math.max(levelPoints, scorePoints, activePoints));
}

function computeClimateRisk(profile, { assessedAt = new Date(), policy: policyInput } = {}) {
  const policy = resolveClimateRiskPolicy(policyInput);
  const base = PROFILE_BASE_SCORE[profile.vulnerability];
  if (base === undefined) {
    throw new DomainError(400, 'VALIDATION_ERROR', `Unsupported vulnerability level: ${profile.vulnerability}`);
  }
  let score = base;
  const factors = [`profile_${profile.vulnerability.toLowerCase()}:${base}`];
  if (profile.displaced === true) {
    score += policy.displacedBonus;
    factors.push(`displaced:+${policy.displacedBonus}`);
  }
  const exposurePoints = hazardBonus(profile.hazardExposure);
  if (exposurePoints) {
    score += exposurePoints;
    factors.push(`hazard_exposure:+${exposurePoints}`);
  }
  const profileTime = profile.assessedAt ? new Date(profile.assessedAt).getTime() : Number.NaN;
  const scoringTime = new Date(assessedAt).getTime();
  const ageDays = Number.isFinite(profileTime) && Number.isFinite(scoringTime)
    ? Math.max(0, Math.floor((scoringTime - profileTime) / DAY_MS))
    : null;
  if (ageDays === null || ageDays > policy.staleAssessmentDays) {
    score += policy.staleAssessmentBonus;
    factors.push(`assessment_uncertainty:+${policy.staleAssessmentBonus}`);
  }
  const finalScore = clamp(score);
  return {
    score: finalScore,
    priority: priorityForRiskScore(finalScore, policy),
    factors,
    assessmentAgeDays: ageDays,
    policyVersion: policy.version,
  };
}

module.exports = {
  DEFAULT_CLIMATE_RISK_POLICY: DEFAULT_POLICY,
  resolveClimateRiskPolicy,
  priorityForRiskScore,
  computeClimateRisk,
};
