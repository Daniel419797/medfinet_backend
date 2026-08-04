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
    '20260729013000_add_offline_sync_and_outbox',
    'migration.sql'
  ),
  'utf8'
);

test('offline migration creates devices, operation logs, and durable outbox', () => {
  for (const table of ['field_devices', 'sync_batches', 'sync_operations', 'outbox_events']) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(migration, /'DEAD_LETTER'/);
});

test('offline migration enforces device, batch, operation, and outbox invariants', () => {
  assert.match(migration, /field_devices_revocation_check/);
  assert.match(migration, /sync_batches_operation_count_check/);
  assert.match(migration, /sync_batches_completion_check/);
  assert.match(migration, /sync_operations_result_check/);
  assert.match(migration, /outbox_events_lock_check/);
  assert.match(migration, /outbox_events_publication_check/);
});

test('offline tables have idempotency keys, tenant foreign keys, and forced RLS', () => {
  assert.match(migration, /sync_batches_deviceId_clientBatchId_key/);
  assert.match(migration, /sync_operations_deviceId_clientOperationId_key/);
  assert.match(migration, /outbox_events_idempotency_key/);
  assert.match(migration, /sync_operations_deviceId_organizationId_fkey/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /medfinet_current_organization_id/);
});
