const assert = require('node:assert/strict');
const test = require('node:test');
const {
  IMMUNIZATION_FINGERPRINT_VERSION,
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

test('creates a deterministic, explicitly versioned immunization fingerprint', () => {
  const first = recordedImmunizationAnchorId(record());
  const reordered = recordedImmunizationAnchorId({
    administeringSubjectId: record().administeringSubjectId,
    ...record(),
  });

  assert.equal(IMMUNIZATION_FINGERPRINT_VERSION, 1);
  assert.equal(first, reordered);
  assert.match(first, /^immunization-recorded:v1:immunization-1:[a-f0-9]{64}$/);
});

test('canonicalizes amendment JSON objects before fingerprinting', () => {
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

  assert.equal(first, reordered);
  assert.match(first, /^immunization-amended:v1:amendment-1:[a-f0-9]{64}$/);
});

test('Algorand note contains no tenant, child, worker, or clinical field', () => {
  const sensitive = record();
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
