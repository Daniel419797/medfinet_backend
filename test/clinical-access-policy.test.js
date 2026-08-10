const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CLINICAL_READ_ROLES,
  CLINICAL_WRITE_ROLES,
  assertClinicalWriteAccess,
} = require('../services/clinicalAccessPolicy');

test('allows administrators to read clinical records while preserving caregiver read access', () => {
  assert.deepEqual([...CLINICAL_READ_ROLES].sort(), [
    'ADMIN',
    'CAREGIVER',
    'HEALTH_WORKER',
    'OWNER',
  ]);
});

test('limits clinical writes to owner, administrator, and health worker roles', () => {
  assert.deepEqual([...CLINICAL_WRITE_ROLES].sort(), [
    'ADMIN',
    'HEALTH_WORKER',
    'OWNER',
  ]);
  assert.doesNotThrow(() => assertClinicalWriteAccess({ role: 'HEALTH_WORKER' }));
  assert.throws(
    () => assertClinicalWriteAccess({ role: 'CAREGIVER' }),
    (error) => error.code === 'CLINICAL_WRITE_ACCESS_DENIED'
  );
});
