const assert = require('node:assert/strict');
const test = require('node:test');
const {
  calculateOrganizationMetrics,
  disclosureFor,
  percentageMetric,
} = require('../services/analyticsMetrics');

test('calculates server-owned aggregate metrics without loading child rows', async () => {
  const countResults = [20, 15, 12, 10, 8, 5, 4, 31];
  let countIndex = 0;
  const counter = {
    async count() {
      const result = countResults[countIndex];
      countIndex += 1;
      return result;
    },
  };
  const transaction = {
    child: counter,
    worklistEntry: counter,
    referral: counter,
    serviceDelivery: counter,
  };

  const metrics = await calculateOrganizationMetrics(
    transaction,
    'org-1',
    {
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-02-01T00:00:00.000Z'),
    }
  );

  assert.equal(metrics.length, 6);
  assert.equal(metrics.find(({ metricKey }) => (
    metricKey === 'immunization_reach'
  )).valueBasisPoints, 7500);
  assert.equal(metrics.find(({ metricKey }) => (
    metricKey === 'service_deliveries'
  )).numerator, 31);
  assert.equal(countIndex, 8);
});

test('suppresses a public metric below the approved minimum cell size', () => {
  const metric = percentageMetric('referral_completion', 4, 9);
  assert.deepEqual(
    disclosureFor(metric, { isPublicEnabled: true, minimumCellSize: 10 }),
    {
      disclosureStatus: 'SUPPRESSED',
      suppressionReason: 'MINIMUM_CELL_SIZE',
    }
  );
  assert.deepEqual(
    disclosureFor(metric, { isPublicEnabled: false, minimumCellSize: 10 }),
    { disclosureStatus: 'INTERNAL', suppressionReason: null }
  );
});
