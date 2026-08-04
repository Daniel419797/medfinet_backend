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
    '20260729080000_add_localization_content',
    'migration.sql'
  ),
  'utf8'
);

test('migrates legacy language names and enforces approved locale codes', () => {
  for (const code of ['en', 'ha', 'yo', 'ig']) {
    assert.match(migration, new RegExp(`'${code}'`));
  }
  assert.match(migration, /caregivers_preferred_language_check/);
  assert.match(migration, /localization_content_one_active_translation/);
  assert.match(migration, /localization_content_lifecycle_check/);
  assert.match(
    migration,
    /ALTER TABLE "localization_content" FORCE ROW LEVEL SECURITY/
  );
});
