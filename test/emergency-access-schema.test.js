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
    '20260728233000_add_emergency_access',
    'migration.sql'
  ),
  'utf8'
);

test('emergency migration enforces time, review, and revocation invariants', () => {
  assert.match(migration, /CREATE TABLE "emergency_accesses"/);
  assert.match(migration, /emergency_accesses_time_check/);
  assert.match(migration, /emergency_accesses_revocation_check/);
  assert.match(migration, /emergency_accesses_review_check/);
});

test('emergency migration prevents concurrent active access per actor and child', () => {
  assert.match(migration, /emergency_accesses_one_active_actor_child_key/);
  assert.match(migration, /WHERE "status" = 'ACTIVE'/);
});

test('emergency access is tenant-bound and protected with forced RLS', () => {
  assert.match(migration, /emergency_accesses_childId_organizationId_fkey/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /medfinet_current_organization_id/);
});
