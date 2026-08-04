const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAnalyticsGenerationService,
} = require('../services/analyticsGenerationService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'system:worker-1',
  purpose: 'background-processing',
};

test('generates immutable publication-classified snapshots in one tenant', async () => {
  const run = {
    id: 'run-1',
    organizationId: 'org-1',
    status: 'QUEUED',
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-02-01T00:00:00.000Z'),
  };
  let snapshots;
  const tx = {
    async $executeRawUnsafe() {},
    analyticsGenerationRun: {
      async updateMany({ data }) {
        Object.assign(run, data);
        return { count: 1 };
      },
      async findUnique() {
        return run;
      },
      async update({ data }) {
        Object.assign(run, data);
        return run;
      },
    },
    analyticsPublicationPolicy: {
      async findUnique() {
        return { isPublicEnabled: true, minimumCellSize: 10 };
      },
    },
    aggregateMetricSnapshot: {
      async createMany({ data }) {
        snapshots = data;
      },
    },
  };
  const now = new Date('2026-02-01T00:05:00.000Z');
  const service = createAnalyticsGenerationService(
    databaseWithTransaction(tx),
    {
      now: () => now,
      async calculateMetrics() {
        return [
          {
            metricKey: 'registered_children',
            numerator: 20,
            denominator: null,
            valueBasisPoints: null,
            unit: 'COUNT',
            cohortSize: 20,
          },
          {
            metricKey: 'referral_completion',
            numerator: 3,
            denominator: 5,
            valueBasisPoints: 6000,
            unit: 'PERCENT',
            cohortSize: 5,
          },
        ];
      },
    }
  );

  const result = await service.process(context, 'run-1');

  assert.equal(result.run.status, 'COMPLETED');
  assert.equal(result.run.metricCount, 2);
  assert.equal(snapshots[0].disclosureStatus, 'PUBLISHED');
  assert.equal(snapshots[1].disclosureStatus, 'SUPPRESSED');
  assert.equal(snapshots[1].suppressionReason, 'MINIMUM_CELL_SIZE');
  assert.equal(snapshots[0].dimensionValue, 'org-1');
});
