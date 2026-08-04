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
    '20260728213000_add_clinical_continuity',
    'migration.sql'
  ),
  'utf8'
);

const protectedTables = [
  'child_credentials',
  'credential_scans',
  'immunization_records',
  'growth_measurements',
  'clinical_alerts',
  'appointments',
  'clinical_amendments',
];

test('clinical migration creates every continuity-of-care table', () => {
  for (const table of protectedTables) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
});

test('clinical migration applies forced tenant isolation to every protected table', () => {
  assert.match(migration, /FOREACH table_name IN ARRAY/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /medfinet_current_organization_id/);

  for (const table of protectedTables) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
});

test('clinical migration enforces immutable relationship and data invariants', () => {
  assert.match(migration, /child_credentials_revocation_check/);
  assert.match(migration, /clinical_alerts_resolution_check/);
  assert.match(migration, /clinical_amendments_target_check/);
  assert.match(migration, /immunization_records_dose_check/);
  assert.match(migration, /growth_measurements_values_check/);
  assert.match(migration, /childId_organizationId_fkey/);
  assert.match(migration, /facilities_id_organizationId_key/);
  assert.match(migration, /programmes_id_organizationId_key/);
});
