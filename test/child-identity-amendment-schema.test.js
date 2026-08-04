const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260729130000_add_child_identity_amendments',
    'migration.sql'
  ),
  'utf8'
);

test('adds maker-checker immutable child identity corrections', () => {
  assert.match(migration, /child_identity_amendments_lifecycle_check/);
  assert.match(migration, /child_identity_amendments_maker_checker_check/);
  assert.match(migration, /child_identity_amendments_one_pending_child/);
  assert.match(
    migration,
    /ALTER TABLE "child_identity_amendments" FORCE ROW LEVEL SECURITY/
  );
  assert.match(
    migration,
    /child_identity_amendments_terminal_immutable/
  );
});
