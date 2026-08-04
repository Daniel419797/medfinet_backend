const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const schema = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'schema.prisma'),
  'utf8'
);
const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260729060000_add_privacy_preserving_analytics',
    'migration.sql'
  ),
  'utf8'
);

test('defines immutable aggregate snapshots and publication governance', () => {
  for (const model of [
    'AnalyticsPublicationPolicy',
    'AnalyticsGenerationRun',
    'AggregateMetricSnapshot',
  ]) {
    assert.match(schema, new RegExp(`model ${model}`));
  }
  assert.match(migration, /minimumCellSize" BETWEEN 10 AND 1000/);
  assert.match(migration, /prevent_aggregate_metric_mutation/);
  assert.match(migration, /aggregate metric snapshots are immutable/);
});

test('forces tenant isolation for every analytics table', () => {
  for (const table of [
    'analytics_publication_policies',
    'analytics_generation_runs',
    'aggregate_metric_snapshots',
  ]) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
    );
    assert.match(
      migration,
      new RegExp(`CREATE POLICY "${table}_tenant_isolation"`)
    );
  }
});
