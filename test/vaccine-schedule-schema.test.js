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
    '20260729120000_add_vaccine_schedule_rules',
    'migration.sql'
  ),
  'utf8'
);

test('adds approved versioned tenant vaccine schedule rules', () => {
  assert.match(migration, /CREATE TABLE "vaccine_schedule_rules"/);
  assert.match(migration, /vaccine_schedule_rules_numbers_check/);
  assert.match(migration, /vaccine_schedule_rules_lifecycle_check/);
  assert.match(migration, /vaccine_schedule_rules_one_active_rule/);
  assert.match(
    migration,
    /ALTER TABLE "vaccine_schedule_rules" FORCE ROW LEVEL SECURITY/
  );
});
