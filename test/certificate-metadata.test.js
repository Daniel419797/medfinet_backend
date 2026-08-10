const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const {
  buildAmendedImmunizationSnapshot,
  buildInitialImmunizationSnapshot,
  saveImmunizationSnapshot,
  snapshotForEvidence,
} = require('../services/certificateMetadataService');

function context(overrides = {}) {
  return {
    organizationId: 'org-1',
    actorSubjectId: 'worker-1',
    actorDisplayName: 'Worker One',
    role: 'HEALTH_WORKER',
    ...overrides,
  };
}

function transaction(facility = {}) {
  return {
    facility: {
      async findFirst() {
        return {
          id: 'facility-1',
          name: 'Dennis Primary Health Centre',
          administrativeArea: 'Delta',
          isActive: true,
          ...facility,
        };
      },
    },
  };
}

test('new vaccination snapshot requires an active registered facility and complete certificate location', async () => {
  await assert.rejects(
    buildInitialImmunizationSnapshot(transaction(), context(), {
      state: 'Delta',
      lga: 'Uvwie',
      ward: 'Ekpan',
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );

  await assert.rejects(
    buildInitialImmunizationSnapshot(
      transaction({ isActive: false }),
      context(),
      {
        facilityId: 'facility-1',
        state: 'Delta',
        lga: 'Uvwie',
        ward: 'Ekpan',
      }
    ),
    (error) => error.code === 'FACILITY_INACTIVE' && error.status === 409
  );

  await assert.rejects(
    buildInitialImmunizationSnapshot(transaction(), context(), {
      facilityId: 'facility-1',
      state: 'Delta',
      lga: 'Uvwie',
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('SELF vaccination snapshots preserve recorder and actual vaccinator separately', async () => {
  const snapshot = await buildInitialImmunizationSnapshot(
    transaction(),
    context(),
    {
      facilityId: 'facility-1',
      state: 'Delta',
      lga: 'Uvwie',
      ward: 'Ekpan',
      vaccinatorMode: 'SELF',
    }
  );

  assert.deepEqual(snapshot, {
    facilityId: 'facility-1',
    facilityName: 'Dennis Primary Health Centre',
    state: 'Delta',
    lga: 'Uvwie',
    ward: 'Ekpan',
    vaccinatorName: 'Worker One',
    vaccinatorSubjectId: 'worker-1',
    recordedBySubjectId: 'worker-1',
  });
});

test('OTHER vaccinator keeps the recorder identity but does not misattribute the external vaccinator subject ID', async () => {
  const snapshot = await buildInitialImmunizationSnapshot(
    transaction(),
    context(),
    {
      facilityId: 'facility-1',
      state: 'Delta',
      lga: 'Uvwie',
      ward: 'Ekpan',
      vaccinatorMode: 'OTHER',
      vaccinatorName: 'Nurse Ada Okafor',
    }
  );

  assert.equal(snapshot.vaccinatorName, 'Nurse Ada Okafor');
  assert.equal(snapshot.vaccinatorSubjectId, null);
  assert.equal(snapshot.recordedBySubjectId, 'worker-1');
});

test('offline SELF payload may supply the authenticated worker display name without changing subject attribution', async () => {
  const snapshot = await buildInitialImmunizationSnapshot(
    transaction(),
    context({ actorDisplayName: '' }),
    {
      facilityId: 'facility-1',
      facilityName: 'Dennis Primary Health Centre',
      state: 'Delta',
      lga: 'Uvwie',
      ward: 'Ekpan',
      vaccinatorMode: 'SELF',
      vaccinatorName: 'Worker One Offline',
    }
  );

  assert.equal(snapshot.vaccinatorName, 'Worker One Offline');
  assert.equal(snapshot.vaccinatorSubjectId, 'worker-1');
  assert.equal(snapshot.recordedBySubjectId, 'worker-1');
});

test('legacy amendment does not invent State, LGA or Ward from the current facility profile', async () => {
  const existingRecord = {
    id: 'immunization-legacy',
    organizationId: 'org-1',
    facilityId: 'facility-1',
    administeringSubjectId: 'original-recorder',
  };

  await assert.rejects(
    buildAmendedImmunizationSnapshot(
      transaction({ administrativeArea: 'Current State' }),
      context(),
      existingRecord,
      {
        facilityId: 'facility-1',
        vaccinatorMode: 'OTHER',
        vaccinatorName: 'Verified Historical Nurse',
      },
      null
    ),
    (error) => error.code === 'VALIDATION_ERROR'
  );

  const snapshot = await buildAmendedImmunizationSnapshot(
    transaction(),
    context(),
    existingRecord,
    {
      facilityId: 'facility-1',
      state: 'Delta',
      lga: 'Uvwie',
      ward: 'Ekpan',
      vaccinatorMode: 'OTHER',
      vaccinatorName: 'Verified Historical Nurse',
    },
    null
  );

  assert.equal(snapshot.facilityName, 'Dennis Primary Health Centre');
  assert.equal(snapshot.state, 'Delta');
  assert.equal(snapshot.vaccinatorName, 'Verified Historical Nurse');
  assert.equal(snapshot.recordedBySubjectId, 'original-recorder');
});

test('mocked unit-of-work can retain a complete in-memory snapshot while production persistence uses the dedicated store', async () => {
  const snapshot = {
    facilityId: 'facility-1',
    facilityName: 'Dennis Primary Health Centre',
    state: 'Delta',
    lga: 'Uvwie',
    ward: 'Ekpan',
    vaccinatorName: 'Worker One',
    vaccinatorSubjectId: 'worker-1',
    recordedBySubjectId: 'worker-1',
  };
  const saved = await saveImmunizationSnapshot(
    {},
    context(),
    'immunization-1',
    snapshot
  );
  assert.deepEqual(snapshotForEvidence(saved), snapshot);
});

test('certificate metadata migration creates tenant-isolated historical evidence tables', () => {
  const migration = readFileSync(
    join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20260810161000_certificate_metadata_snapshots',
      'migration.sql'
    ),
    'utf8'
  );

  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS medfinet_certificate/);
  assert.match(migration, /CREATE TABLE medfinet_certificate\.facility_profiles/);
  assert.match(migration, /CREATE TABLE medfinet_certificate\.immunization_snapshots/);
  assert.match(migration, /vaccinator_name TEXT/);
  assert.match(migration, /recorded_by_subject_id TEXT NOT NULL/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /app\.current_organization_id/);
});
