const assert = require('node:assert/strict');
const test = require('node:test');
const {
  baseUrl,
  dataCategories,
  resourceType,
} = require('../services/integrationValidation');
const {
  mappingDefinition,
} = require('../services/integrationMappingService');
const { secretName } = require('../services/integrationConnectionService');
const {
  normalizeCriteria,
} = require('../services/integrationJobService');

test('requires HTTPS endpoints on an explicit production host allowlist', () => {
  assert.equal(
    baseUrl('https://fhir.example.com/r4/', {
      allowedHosts: ['fhir.example.com'],
    }),
    'https://fhir.example.com/r4'
  );
  assert.throws(
    () => baseUrl('https://metadata.internal/latest', {
      allowedHosts: ['fhir.example.com'],
    }),
    (error) => error.code === 'INTEGRATION_HOST_NOT_ALLOWED'
  );
  assert.throws(() => baseUrl('http://fhir.example.com'), /must use HTTPS/);
  assert.throws(
    () => baseUrl('https://user:password@fhir.example.com'),
    /cannot contain credentials/
  );
});

test('accepts only known resources, scopes, and managed-secret references', () => {
  assert.deepEqual(
    dataCategories(['IDENTITY', 'IMMUNIZATION', 'IDENTITY']),
    ['IDENTITY', 'IMMUNIZATION']
  );
  assert.equal(resourceType('FHIR_R4', 'Patient'), 'Patient');
  assert.equal(secretName('FHIR_PARTNER_TOKEN'), 'FHIR_PARTNER_TOKEN');
  assert.throws(() => secretName('raw-secret-value'), /managed-secret reference/);
  assert.throws(() => resourceType('FHIR_R4', 'Binary'), /not supported/);
});

test('rejects executable or unbounded mapping definitions', () => {
  assert.deepEqual(
    mappingDefinition('FHIR_R4', 'Patient', {
      identifierSystem: 'https://example.com/ids',
    }),
    { identifierSystem: 'https://example.com/ids' }
  );
  assert.throws(
    () => mappingDefinition('FHIR_R4', 'Patient', {
      script: 'return process.env',
    }),
    (error) => error.code === 'UNSAFE_INTEGRATION_MAPPING'
  );
  assert.throws(
    () => mappingDefinition('DHIS2', 'EVENT', {}),
    /programId is required/
  );
});

test('bounds export criteria and removes duplicate child identifiers', () => {
  assert.deepEqual(
    normalizeCriteria('EXPORT', { childIds: ['child-1', 'child-1', 'child-2'] }),
    { childIds: ['child-1', 'child-2'] }
  );
  assert.throws(
    () => normalizeCriteria('EXPORT', { childIds: [] }),
    /between 1 and 500/
  );
});
