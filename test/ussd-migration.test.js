const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260729210000_add_production_ussd',
  'migration.sql'
), 'utf8');
const directorySql = fs.readFileSync(path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260729211000_add_ussd_facility_directory',
  'migration.sql'
), 'utf8');
const suspendedNfcSql = fs.readFileSync(path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260729215000_allow_suspended_nfc_lifecycle',
  'migration.sql'
), 'utf8');

test('creates durable records for all ten USSD workflow groups', () => {
  for (const table of [
    'ussd_sessions',
    'ussd_phone_routes',
    'ussd_otp_challenges',
    'appointment_caregiver_responses',
    'ussd_callback_requests',
    'nfc_card_support_requests',
    'ussd_consent_requests',
    'programme_interests',
    'service_delivery_confirmations',
    'reward_redemption_confirmations',
    'climate_assistance_requests',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
  }
});

test('forces tenant isolation for every tenant-owned USSD action table', () => {
  for (const table of [
    'ussd_otp_challenges',
    'appointment_caregiver_responses',
    'ussd_callback_requests',
    'nfc_card_support_requests',
    'ussd_consent_requests',
    'programme_interests',
    'service_delivery_confirmations',
    'reward_redemption_confirmations',
    'climate_assistance_requests',
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`CREATE POLICY "${table}_tenant_policy"`));
  }
});

test('keeps provider routing PHI-free and constrains sensitive account state', () => {
  assert.doesNotMatch(sql, /"phoneNumber" TEXT/);
  assert.match(sql, /caregivers_ussd_pin_attempts_check/);
  assert.match(sql, /ussd_sessions_phone_last_four_check/);
  assert.match(sql, /ussd_consent_requests_scopes_check/);
});

test('publishes a separate PHI-free facility directory for public lookup', () => {
  assert.match(directorySql, /CREATE TABLE "ussd_facility_directory"/);
  assert.match(directorySql, /"administrativeArea" TEXT NOT NULL/);
  assert.match(directorySql, /"programmeCategories" JSONB/);
  assert.doesNotMatch(directorySql, /"childId"|"caregiverId"|dateOfBirth/);
});

test('allows a protected active NFC card to enter the suspended lifecycle state', () => {
  assert.match(suspendedNfcSql, /"status" IN \('ACTIVE', 'SUSPENDED'\)/);
  assert.match(suspendedNfcSql, /"writeProtectedAt" IS NOT NULL/);
  assert.match(suspendedNfcSql, /"configurationLockedAt" IS NOT NULL/);
});
