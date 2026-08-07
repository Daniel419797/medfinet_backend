const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeName,
  scorePair,
  statusFor,
  resolveDuplicatePolicy,
} = require('../services/ai/duplicateDetectionService');
const {
  rulesAnomalies,
  resolveRewardPolicy,
} = require('../services/ai/rewardAnomalyService');
const {
  computeClimateRisk,
  priorityForRiskScore,
  resolveClimateRiskPolicy,
} = require('../services/worklistGenerationService');

function child(overrides = {}) {
  return {
    id: 'child-1',
    firstName: 'Amina',
    lastName: 'Musa',
    dateOfBirth: new Date('2025-01-05T00:00:00.000Z'),
    sex: 'FEMALE',
    ...overrides,
  };
}

function redemption(id, amount, redeemedAt, overrides = {}) {
  return {
    id,
    amount,
    merchantId: 'merchant-1',
    merchantReference: `REF-${id}`,
    redeemedBySubjectId: 'caregiver-1',
    redeemedAt: new Date(redeemedAt),
    ...overrides,
  };
}

test('duplicate normalization handles Nigerian diacritics and punctuation', () => {
  assert.equal(normalizeName('Ọlúwá-Ṣẹ́yí'), 'oluwaseyi');
});

test('duplicate aliases are configurable rather than silently assumed', () => {
  const policy = resolveDuplicatePolicy({
    version: 'ng-pilot-v1',
    aliasGroups: [['Muhammad', 'Mohammed', 'Muhammed']],
  });
  const result = scorePair(
    child({ firstName: 'Muhammad' }),
    child({ id: 'child-2', firstName: 'Mohammed' }),
    policy
  );
  assert.equal(result.components.name, 1);
  assert.equal(result.score, 1);
});

test('duplicate scoring recognizes swapped names and common DOB transcription patterns', () => {
  const result = scorePair(
    child({ firstName: 'Amina', lastName: 'Musa', dateOfBirth: new Date('2025-01-05') }),
    child({
      id: 'child-2',
      firstName: 'Musa',
      lastName: 'Amina',
      dateOfBirth: new Date('2025-05-01'),
    })
  );
  assert.ok(result.matchedFields.includes('first_and_last_name_swapped'));
  assert.ok(result.matchedFields.includes('date_of_birth_day_month_swapped'));
  assert.ok(result.score >= 0.8);
});

test('duplicate status thresholds are policy-controlled and validated', () => {
  assert.equal(
    statusFor(0.72, { likelyThreshold: 0.7, possibleThreshold: 0.4 }),
    'LIKELY_DUPLICATE'
  );
  assert.throws(
    () => resolveDuplicatePolicy({ likelyThreshold: 0.5, possibleThreshold: 0.5 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('reward velocity uses a bounded lookback window rather than lifetime totals', () => {
  const separated = rulesAnomalies([
    redemption('r1', 100, '2026-07-01T10:00:00Z'),
    redemption('r2', 100, '2026-07-03T10:00:00Z'),
    redemption('r3', 100, '2026-07-05T10:00:00Z'),
  ]);
  assert.ok(separated.every((item) => (
    !item.signals.some((signal) => signal.startsWith('high_redemption_velocity'))
  )));

  const clustered = rulesAnomalies([
    redemption('r1', 100, '2026-07-01T10:00:00Z'),
    redemption('r2', 100, '2026-07-01T10:20:00Z'),
    redemption('r3', 100, '2026-07-01T10:40:00Z'),
  ]);
  const latest = clustered.find((item) => item.redemptionId === 'r3');
  assert.ok(latest.signals.some((signal) => signal.startsWith('high_redemption_velocity:3')));
  assert.equal(latest.suspicious, true);
});

test('reward amount outliers wait for enough peers', () => {
  const items = rulesAnomalies([
    redemption('r1', 1000, '2026-07-01T10:00:00Z'),
    redemption('r2', 100, '2026-07-01T09:00:00Z', { redeemedBySubjectId: 'caregiver-2' }),
    redemption('r3', 100, '2026-07-01T08:00:00Z', { redeemedBySubjectId: 'caregiver-3' }),
  ]);
  const outlier = items.find((item) => item.redemptionId === 'r1');
  assert.equal(outlier.evidence.amountBaseline, null);
  assert.ok(!outlier.signals.some((signal) => signal.startsWith('amount_outlier')));
});

test('reward amount outliers use leave-one-out peers and a dispersion floor', () => {
  const items = rulesAnomalies([
    redemption('outlier', 500, '2026-07-02T10:00:00Z'),
    ...Array.from({ length: 6 }, (_, index) => redemption(
      `peer-${index}`,
      100,
      `2026-07-01T0${index}:00:00Z`,
      { redeemedBySubjectId: `caregiver-${index + 2}` }
    )),
  ]);
  const outlier = items.find((item) => item.redemptionId === 'outlier');
  assert.equal(outlier.evidence.amountBaseline.source, 'merchant');
  assert.equal(outlier.evidence.amountBaseline.peerCount, 6);
  assert.ok(outlier.evidence.amountBaseline.standardDeviation > 0);
  assert.ok(outlier.signals.some((signal) => signal.startsWith('amount_outlier')));
});

test('reward policy parameters are bounded', () => {
  assert.throws(
    () => resolveRewardPolicy({ minimumOutlierPeers: 1 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('climate prioritization produces an explainable deterministic score', () => {
  const result = computeClimateRisk({
    vulnerability: 'MEDIUM',
    displaced: true,
    hazardExposure: { severity: 'HIGH', activeHazards: ['flood'] },
    assessedAt: new Date('2026-07-01T00:00:00Z'),
  }, { assessedAt: new Date('2026-07-10T00:00:00Z') });

  assert.equal(result.score, 60);
  assert.equal(result.priority, 'MEDIUM');
  assert.deepEqual(result.factors, [
    'profile_medium:40',
    'displaced:+10',
    'hazard_exposure:+10',
  ]);
  assert.equal(result.policyVersion, 'climate-worklist-risk-v1');
});

test('stale climate assessments are surfaced conservatively without claiming probability', () => {
  const result = computeClimateRisk({
    vulnerability: 'HIGH',
    displaced: false,
    hazardExposure: null,
    assessedAt: new Date('2025-01-01T00:00:00Z'),
  }, { assessedAt: new Date('2026-01-01T00:00:00Z') });
  assert.equal(result.score, 70);
  assert.equal(result.priority, 'HIGH');
  assert.ok(result.factors.includes('assessment_uncertainty:+5'));
});

test('climate thresholds are configurable and ordered', () => {
  assert.equal(priorityForRiskScore(55, {
    mediumThreshold: 30,
    highThreshold: 50,
    criticalThreshold: 80,
  }), 'HIGH');
  assert.throws(
    () => resolveClimateRiskPolicy({ mediumThreshold: 70, highThreshold: 60 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});
