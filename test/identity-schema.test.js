const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.resolve(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260728160000_add_medfinet_identity_foundation',
  'migration.sql'
);

test('migration enforces tenant RLS and cross-tenant caregiver constraints', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');

  for (const table of ['facilities', 'programmes', 'caregivers', 'children', 'child_caregivers', 'audit_events']) {
    assert.match(migration, new RegExp(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`CREATE POLICY "${table}_tenant_isolation"`));
  }

  assert.match(migration, /child_caregivers_childId_organizationId_fkey/);
  assert.match(migration, /child_caregivers_caregiverId_organizationId_fkey/);
  assert.match(migration, /current_setting\('app\.current_organization_id'/);

  const tenantContext = fs.readFileSync(
    path.resolve(__dirname, '..', 'services', 'tenantContext.js'),
    'utf8'
  );
  assert.match(tenantContext, /set_config\('app\.current_organization_id'/);
});
