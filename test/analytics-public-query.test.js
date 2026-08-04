const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAnalyticsQueryService,
} = require('../services/analyticsQueryService');

function databaseWithTransaction(transaction) {
  return {
    organization: {
      async findUnique() {
        return { id: 'org-1', status: 'ACTIVE' };
      },
    },
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('public analytics returns only pre-published aggregate snapshots', async () => {
  let snapshotWhere;
  const tx = {
    async $executeRawUnsafe() {},
    analyticsPublicationPolicy: {
      async findUnique() {
        return {
          isPublicEnabled: true,
          publicOrganizationName: 'Public Pilot',
        };
      },
    },
    analyticsGenerationRun: {
      async findFirst() {
        return {
          id: 'run-1',
          periodStart: new Date('2026-01-01T00:00:00.000Z'),
          periodEnd: new Date('2026-02-01T00:00:00.000Z'),
          completedAt: new Date('2026-02-01T00:01:00.000Z'),
        };
      },
    },
    aggregateMetricSnapshot: {
      async findMany({ where }) {
        snapshotWhere = where;
        return [{
          metricKey: 'registered_children',
          numerator: 100,
          denominator: null,
          valueBasisPoints: null,
          cohortSize: 100,
          disclosureStatus: 'PUBLISHED',
          suppressionReason: null,
          dataThrough: new Date('2026-02-01T00:00:30.000Z'),
        }];
      },
    },
  };

  const result = await createAnalyticsQueryService(
    databaseWithTransaction(tx)
  ).publicMetrics('public-pilot');

  assert.equal(snapshotWhere.disclosureStatus, 'PUBLISHED');
  assert.equal(snapshotWhere.dimensionType, 'ORGANIZATION');
  assert.equal(result.metrics.length, 1);
  assert.equal(JSON.stringify(result).includes('child-'), false);
});
