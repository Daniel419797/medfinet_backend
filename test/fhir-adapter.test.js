const assert = require('node:assert/strict');
const test = require('node:test');
const {
  patientResource,
  observationResource,
  validateFhirResource,
} = require('../services/fhirR4Adapter');
const {
  observationInput,
} = require('../services/fhirImportMapper');

const child = {
  medfinetId: 'MED-1',
  firstName: 'Amina',
  lastName: 'Musa',
  dateOfBirth: new Date('2024-01-02T00:00:00.000Z'),
  sex: 'FEMALE',
  status: 'ACTIVE',
};

test('maps Medfinet identity into a valid FHIR R4 Patient', () => {
  const patient = patientResource(child, {
    identifierSystem: 'https://partner.example/medfinet-id',
  });
  assert.equal(patient.resourceType, 'Patient');
  assert.equal(patient.gender, 'female');
  assert.equal(patient.birthDate, '2024-01-02');
  assert.equal(patient.identifier[0].value, 'MED-1');
});

test('round-trips growth units without kilograms-to-grams drift', () => {
  const resource = observationResource(
    {
      id: 'growth-1',
      weightGrams: 12500,
      heightMillimeters: 920,
      muacMillimeters: 135,
      measuredAt: new Date('2026-07-01T10:00:00.000Z'),
    },
    child,
    { codeSystems: { observation: 'urn:oid:1.2.3.4' } }
  );
  const command = observationInput('connection-1', resource);

  assert.equal(command.input.weightGrams, 12500);
  assert.equal(command.input.heightMillimeters, 920);
  assert.equal(command.input.muacMillimeters, 135);
});

test('rejects a partner resource with the wrong FHIR type', () => {
  assert.throws(
    () => validateFhirResource({ resourceType: 'Binary' }, 'Patient'),
    (error) => error.code === 'FHIR_RESOURCE_INVALID'
  );
});
