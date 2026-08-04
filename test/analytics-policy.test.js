const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizePolicy,
} = require('../services/analyticsPolicyService');
const {
  normalizePeriod,
} = require('../services/analyticsGenerationService');

const context = { actorSubjectId: 'owner-1' };

test('requires a reviewed public label and safe cell-size threshold', () => {
  const policy = normalizePolicy(context, {
    isPublicEnabled: true,
    minimumCellSize: 25,
    maximumGeography: 'STATE',
    publicOrganizationName: 'Medfinet Kano Pilot',
  });

  assert.equal(policy.approvedBySubjectId, 'owner-1');
  assert.equal(policy.minimumCellSize, 25);
  assert.equal(policy.publicOrganizationName, 'Medfinet Kano Pilot');
  assert.throws(
    () => normalizePolicy(context, {
      isPublicEnabled: true,
      minimumCellSize: 9,
      publicOrganizationName: 'Unsafe',
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('rejects future and unbounded analytics periods', () => {
  const now = new Date('2026-07-29T12:00:00.000Z');
  assert.throws(
    () => normalizePeriod({
      periodStart: '2024-01-01T00:00:00.000Z',
      periodEnd: '2026-01-01T00:00:00.000Z',
    }, now),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.throws(
    () => normalizePeriod({
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-01T00:00:00.000Z',
    }, now),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});
