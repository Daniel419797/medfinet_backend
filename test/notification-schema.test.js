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
    '20260729040000_add_notifications',
    'migration.sql'
  ),
  'utf8'
);

test('defines preferences, versioned templates, messages, and delivery attempts', () => {
  for (const model of [
    'NotificationPreference',
    'NotificationTemplate',
    'NotificationMessage',
    'NotificationDeliveryAttempt',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  assert.match(migration, /notification_templates_one_active_key/);
  assert.match(migration, /notification_messages_idempotency_key/);
  assert.match(migration, /notification_preferences_quiet_hours_check/);
  assert.match(migration, /notification_messages_lifecycle_check/);
});

test('forces tenant row-level security on every notification table', () => {
  for (const table of [
    'notification_preferences',
    'notification_templates',
    'notification_messages',
    'notification_delivery_attempts',
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /medfinet_current_organization_id/);
});
