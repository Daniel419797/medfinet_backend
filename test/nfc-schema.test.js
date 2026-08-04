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
    '20260729150000_add_secure_nfc',
    'migration.sql'
  ),
  'utf8'
);

test('adds protected NTAG215 bindings and one-time scanner challenges', () => {
  assert.match(migration, /nfc_bindings_counter_check/);
  assert.match(migration, /nfc_scan_challenges_tokenHash_key/);
  assert.match(migration, /nfc_scan_challenges_lifecycle_check/);
  assert.match(migration, /"hardwareFamily" = 'NTAG_215'/);
  assert.match(migration, /nfc_bindings_identity_immutable/);
  assert.match(
    migration,
    /ALTER TABLE "nfc_credential_bindings" FORCE ROW LEVEL SECURITY/
  );
  assert.match(
    migration,
    /ALTER TABLE "nfc_scan_challenges" FORCE ROW LEVEL SECURITY/
  );
});

test('requires explicit administrator approval for raw NFC provisioning stations', () => {
  const capabilityMigration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20260729160000_add_nfc_device_capabilities',
      'migration.sql'
    ),
    'utf8'
  );
  assert.match(capabilityMigration, /nfcProvisioningEnabled/);
  assert.match(capabilityMigration, /nfc_provisioning_approval_check/);
  assert.match(capabilityMigration, /nfcProvisioningApprovedBySubjectId/);
});
