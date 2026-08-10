const assert = require('node:assert/strict');
const test = require('node:test');
const {
  IMMUNIZATION_FINGERPRINT_VERSION,
  LEGACY_IMMUNIZATION_FINGERPRINT_VERSION,
  amendedImmunizationAnchorId,
  recordedImmunizationAnchorId,
} = require('../services/immunizationIntegrity');
const { buildNote } = require('../services/blockchain/eventTypes');
const {
  issueVaccinationRecord,
  submitSignedTransaction,
} = require('../algorand/algorand');

function record() {
  return {
    id: 'immunization-1',
    organizationId: 'organization-sensitive-id',
    childId: 'child-sensitive-id',
    facilityId: 'facility-1',
    programmeId: null,
    vaccineCode: 'BCG',
    doseNumber: 1,
    administeredAt: new Date('2026-01-10T08:00:00.000Z'),
    lotNumber: 'LOT-PRIVATE-1',
    route: 'INTRADERMAL',
    site: 'LEFT_ARM',
    notes: 'private clinical note',
    administeringSubjectId: 'health-worker-sensitive-id',
  };
}

function certificateMetadata() {
  return {
    facilityId: 'facility-1',
    facilityName: 'Dennis Primary Health Centre',
    state: 'Delta',
    lga: 'Uvwie',
    ward: 'Ekpan',
    vaccinatorName: 'Worker One',
    vaccinatorSubjectId: 'health-worker-sensitive-id',
    recordedBySubjectId: 'health-worker-sensitive-id',
  };
}

test('preserves v1 proof IDs for legacy records while v2 covers certificate metadata', () => {
  const legacy = recordedImmunizationAnchorId(record());
  const reordered = recordedImmunizationAnchorId({
    administeringSubjectId: record().administeringSubjectId,
    ...record(),
  });
  const current = recordedImmunizationAnchorId({
    ...record(),
    certificateMetadata: certificateMetadata(),
  });

  assert.equal(LEGACY_IMMUNIZATION_FINGERPRINT_VERSION, 1);
  assert.equal(IMMUNIZATION_FINGERPRINT_VERSION, 2);
  assert.equal(legacy, reordered);
  assert.match(legacy, /^immunization-recorded:v1:immunization-1:[a-f0-9]{64}$/);
  assert.match(current, /^immunization-recorded:v2:immunization-1:[a-f0-9]{64}$/);
  assert.notEqual(legacy, current);
  assert.notEqual(
    current,
    recordedImmunizationAnchorId({
      ...record(),
      certificateMetadata: { ...certificateMetadata(), ward: 'Other Ward' },
    }),
  );
});

test('canonicalizes amendment JSON objects and versions metadata amendments independently', () => {
  const first = amendedImmunizationAnchorId({
    amendmentId: 'amendment-1',
    recordId: 'immunization-1',
    previous: { lotNumber: 'OLD', nested: { b: 2, a: 1 } },
    replacement: { lotNumber: 'NEW', route: 'ORAL' },
    reason: 'correction',
  });
  const reordered = amendedImmunizationAnchorId({
    amendmentId: 'amendment-1',
    recordId: 'immunization-1',
    previous: { nested: { a: 1, b: 2 }, lotNumber: 'OLD' },
    replacement: { route: 'ORAL', lotNumber: 'NEW' },
    reason: 'correction',
  });
  const metadataAmendment = amendedImmunizationAnchorId({
    amendmentId: 'amendment-2',
    recordId: 'immunization-1',
    previous: { certificateMetadata: certificateMetadata() },
    replacement: {
      certificateMetadata: { ...certificateMetadata(), vaccinatorName: 'Verified Worker' },
    },
    reason: 'verified paper register',
  });

  assert.equal(first, reordered);
  assert.match(first, /^immunization-amended:v1:amendment-1:[a-f0-9]{64}$/);
  assert.match(metadataAmendment, /^immunization-amended:v2:amendment-2:[a-f0-9]{64}$/);
});

test('Algorand note contains no tenant, child, worker, location, or clinical field', () => {
  const sensitive = {
    ...record(),
    certificateMetadata: certificateMetadata(),
  };
  const anchorId = recordedImmunizationAnchorId(sensitive);
  const { note } = buildNote(0x09, sensitive.organizationId, anchorId);
  const publicBytes = note.toString('utf8');

  assert.equal(note.length, 35);
  for (const value of [
    sensitive.organizationId,
    sensitive.childId,
    sensitive.administeringSubjectId,
    sensitive.vaccineCode,
    sensitive.lotNumber,
    sensitive.notes,
    sensitive.certificateMetadata.facilityName,
    sensitive.certificateMetadata.lga,
    sensitive.certificateMetadata.ward,
    sensitive.certificateMetadata.vaccinatorName,
    anchorId,
  ]) {
    assert.equal(publicBytes.includes(value), false);
  }
});

test('legacy vaccination ASA publishing is rejected', async () => {
  for (const operation of [issueVaccinationRecord, submitSignedTransaction]) {
    await assert.rejects(
      operation({ childName: 'Amina', vaccineCode: 'BCG' }),
      (error) => error.code === 'CLINICAL_ASA_PUBLICATION_DISABLED',
    );
  }
});
