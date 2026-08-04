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
    '20260729110000_add_allergies_and_clinical_lifecycle',
    'migration.sql'
  ),
  'utf8'
);

test('adds tenant-isolated allergies and immutable amendment evidence', () => {
  assert.match(migration, /CREATE TABLE "allergy_records"/);
  assert.match(migration, /allergy_records_lifecycle_check/);
  assert.match(
    migration,
    /ALTER TABLE "allergy_records" FORCE ROW LEVEL SECURITY/
  );
  assert.match(migration, /clinical_amendments_immutable/);
});
