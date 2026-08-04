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
    '20260729140000_add_child_identifiers',
    'migration.sql'
  ),
  'utf8'
);

test('adds immutable maker-checker tenant-bound child identifiers', () => {
  assert.match(migration, /child_identifiers_lifecycle_check/);
  assert.match(migration, /child_identifiers_maker_checker_check/);
  assert.match(migration, /child_identifiers_one_verified_primary_child/);
  assert.match(migration, /child_identifiers_identity_immutable/);
  assert.match(
    migration,
    /ALTER TABLE "child_identifiers" FORCE ROW LEVEL SECURITY/
  );
});
