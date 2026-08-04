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
    '20260729100000_add_membership_resource_scopes',
    'migration.sql'
  ),
  'utf8'
);

test('enforces cross-tenant-safe workforce resource scopes with forced RLS', () => {
  assert.match(migration, /MembershipScopeMode/);
  assert.match(migration, /organization_memberships_id_organizationId_key/);
  assert.match(
    migration,
    /membership_facility_scopes_membershipId_organizationId_fkey/
  );
  assert.match(
    migration,
    /membership_programme_scopes_membershipId_organizationId_fkey/
  );
  assert.match(
    migration,
    /ALTER TABLE "membership_facility_scopes" FORCE ROW LEVEL SECURITY/
  );
  assert.match(
    migration,
    /ALTER TABLE "membership_programme_scopes" FORCE ROW LEVEL SECURITY/
  );
});
