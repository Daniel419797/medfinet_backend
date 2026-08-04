const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeRule,
  recommendation,
} = require('../services/vaccineScheduleService');

function rule(overrides = {}) {
  return {
    id: 'rule-1',
    vaccineCode: 'PENTA',
    doseNumber: 1,
    minimumAgeDays: 42,
    recommendedAgeDays: 42,
    maximumAgeDays: 365,
    minimumIntervalDays: null,
    version: 1,
    ...overrides,
  };
}

test('validates chronological vaccine schedule rules', () => {
  assert.equal(normalizeRule({
    vaccineCode: 'penta',
    doseNumber: 2,
    minimumAgeDays: 70,
    recommendedAgeDays: 70,
    maximumAgeDays: 365,
    minimumIntervalDays: 28,
  }).vaccineCode, 'PENTA');
  assert.throws(
    () => normalizeRule({
      vaccineCode: 'PENTA',
      doseNumber: 1,
      minimumAgeDays: 42,
      recommendedAgeDays: 40,
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('marks a recorded dose complete from authoritative clinical records', () => {
  const administeredAt = new Date('2026-02-12T00:00:00.000Z');
  const result = recommendation(
    rule(),
    new Date('2026-01-01T00:00:00.000Z'),
    [{
      vaccineCode: 'PENTA',
      doseNumber: 1,
      administeredAt,
    }],
    new Date('2026-03-01T00:00:00.000Z')
  );

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.completedAt, administeredAt);
});

test('blocks later doses until the previous dose exists', () => {
  const result = recommendation(
    rule({
      doseNumber: 2,
      minimumAgeDays: 70,
      recommendedAgeDays: 70,
      minimumIntervalDays: 28,
    }),
    new Date('2026-01-01T00:00:00.000Z'),
    [],
    new Date('2026-05-01T00:00:00.000Z')
  );

  assert.equal(result.status, 'BLOCKED_PREVIOUS_DOSE');
});

test('uses the later of age and dose interval for catch-up timing', () => {
  const result = recommendation(
    rule({
      doseNumber: 2,
      minimumAgeDays: 70,
      recommendedAgeDays: 70,
      minimumIntervalDays: 28,
    }),
    new Date('2026-01-01T00:00:00.000Z'),
    [{
      vaccineCode: 'PENTA',
      doseNumber: 1,
      administeredAt: new Date('2026-03-20T00:00:00.000Z'),
    }],
    new Date('2026-04-10T00:00:00.000Z')
  );

  assert.equal(result.status, 'NOT_ELIGIBLE');
  assert.equal(result.eligibleAt.toISOString(), '2026-04-17T00:00:00.000Z');
});
