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
    '20260810120000_harden_immunization_records',
    'migration.sql'
  ),
  'utf8'
);

test('adds a migration-safe concurrent immunization deduplication key', () => {
  assert.match(migration, /ADD COLUMN "deduplicationKey" TEXT/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "immunization_records_organizationId_deduplicationKey_key"/
  );
  assert.doesNotMatch(migration, /DELETE FROM "immunization_records"/);
});
