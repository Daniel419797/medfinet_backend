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
    '20260728223000_add_consent_and_disclosure',
    'migration.sql'
  ),
  'utf8'
);

test('consent migration creates scoped, versioned grants and disclosure evidence', () => {
  assert.match(migration, /CREATE TABLE "consent_grants"/);
  assert.match(migration, /CREATE TABLE "consent_scopes"/);
  assert.match(migration, /CREATE TABLE "disclosure_events"/);
  assert.match(migration, /"policyVersion" TEXT NOT NULL/);
  assert.match(migration, /"captureMethod" TEXT NOT NULL/);
  assert.match(migration, /consent_grants_time_check/);
  assert.match(migration, /consent_grants_withdrawal_check/);
});

test('consent migration binds child and caregiver authority within one tenant', () => {
  assert.match(migration, /consent_grants_childId_organizationId_fkey/);
  assert.match(migration, /consent_grants_grantedByCaregiverId_organizationId_fkey/);
  assert.match(migration, /caregivers_organizationId_subjectId_key/);
});

test('consent and disclosure tables use forced row-level tenant isolation', () => {
  for (const table of ['consent_grants', 'consent_scopes', 'disclosure_events']) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /medfinet_current_organization_id/);
});
