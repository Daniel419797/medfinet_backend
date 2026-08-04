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
    '20260729070000_add_data_governance',
    'migration.sql'
  ),
  'utf8'
);

test('defines retention, legal hold, and subject-rights workflows', () => {
  for (const model of [
    'DataRetentionPolicy',
    'RetentionExecutionRun',
    'LegalHold',
    'DataSubjectRequest',
  ]) {
    assert.match(schema, new RegExp(`model ${model}`));
  }
  assert.match(migration, /data_retention_policies_safe_disposition_check/);
  assert.match(migration, /retention_execution_runs_maker_checker_check/);
  assert.match(migration, /legal_holds_one_active_target/);
  assert.match(migration, /data_subject_requests_completion_check/);
  assert.match(migration, /audit_events_immutable/);
});

test('forces tenant RLS over every governance table', () => {
  for (const table of [
    'data_retention_policies',
    'retention_execution_runs',
    'legal_holds',
    'data_subject_requests',
  ]) {
    assert.match(
      migration,
      new RegExp(`'${table}'`)
    );
  }
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /current_organization_id/);
});
