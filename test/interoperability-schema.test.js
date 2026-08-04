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
    '20260729050000_add_interoperability',
    'migration.sql'
  ),
  'utf8'
);

test('defines connections, mappings, jobs, encrypted staging, records, and reconciliation', () => {
  for (const model of [
    'IntegrationConnection',
    'IntegrationMapping',
    'IntegrationJob',
    'IntegrationExchangeRecord',
    'IntegrationImportStaging',
    'IntegrationReconciliationRun',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  assert.match(migration, /integration_mappings_one_active_key/);
  assert.match(migration, /integration_jobs_idempotency_key/);
  assert.match(migration, /payloadCiphertext/);
  assert.match(migration, /integration_exchange_records_hash_check/);
});

test('stores credential references instead of credentials and forces tenant RLS', () => {
  assert.match(schema, /credentialSecretName\s+String/);
  assert.doesNotMatch(schema, /accessToken\s+String|clientSecret\s+String|password\s+String/);
  for (const table of [
    'integration_connections',
    'integration_mappings',
    'integration_jobs',
    'integration_exchange_records',
    'integration_import_staging',
    'integration_reconciliation_runs',
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
});
