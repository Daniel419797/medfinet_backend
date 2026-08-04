const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const migration = readFileSync(
  join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260729003000_add_climate_response',
    'migration.sql'
  ),
  'utf8'
);
const progressMigration = readFileSync(
  join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260729020000_add_worklist_generation_progress',
    'migration.sql'
  ),
  'utf8'
);

const protectedTables = [
  'climate_profiles',
  'climate_events',
  'affected_areas',
  'beneficiary_worklists',
  'worklist_entries',
  'service_deliveries',
  'referrals',
];

test('climate migration creates the complete response workflow', () => {
  for (const table of protectedTables) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
});

test('climate migration enforces authorization and operational invariants', () => {
  assert.match(migration, /beneficiary_worklists_generation_check/);
  assert.match(migration, /beneficiary_worklists_authorization_check/);
  assert.match(migration, /worklist_entries_completion_check/);
  assert.match(migration, /service_deliveries_quantity_check/);
  assert.match(migration, /referrals_closure_check/);
  assert.match(migration, /service_deliveries_source_operation_key/);
  assert.match(migration, /referrals_source_operation_key/);
});

test('every climate-response table is tenant-bound with forced RLS', () => {
  for (const table of protectedTables) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /medfinet_current_organization_id/);
  assert.match(migration, /worklist_entries_childId_organizationId_fkey/);
  assert.match(migration, /service_deliveries_childId_organizationId_fkey/);
  assert.match(migration, /referrals_childId_organizationId_fkey/);
});

test('large worklists persist cursor and count progress', () => {
  assert.match(progressMigration, /"generationCursor" TEXT/);
  assert.match(progressMigration, /"generatedCount" INTEGER NOT NULL DEFAULT 0/);
  assert.match(progressMigration, /beneficiary_worklists_generated_count_check/);
  assert.match(progressMigration, /beneficiary_worklists_generation_queue_idx/);
});
