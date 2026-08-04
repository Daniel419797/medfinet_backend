const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createIntegrationCrypto,
} = require('../services/integrationCrypto');

test('encrypts staged payloads with authenticated AES-GCM and verifies their hash', () => {
  const cryptoService = createIntegrationCrypto({
    keyProvider: () => Buffer.alloc(32, 7),
  });
  const payload = {
    resourceType: 'Patient',
    id: 'MED-1',
    name: [{ family: 'Musa', given: ['Amina'] }],
  };
  const encrypted = cryptoService.encrypt(payload);

  assert.equal(encrypted.payloadHash.length, 64);
  assert.equal(JSON.stringify(encrypted).includes('Amina'), false);
  assert.deepEqual(cryptoService.decrypt(encrypted), payload);
});

test('refuses modified ciphertext instead of returning unauthenticated health data', () => {
  const cryptoService = createIntegrationCrypto({
    keyProvider: () => Buffer.alloc(32, 7),
  });
  const encrypted = cryptoService.encrypt({ resourceType: 'Patient', id: 'MED-1' });
  encrypted.payloadCiphertext = `${encrypted.payloadCiphertext.slice(0, -2)}AA`;

  assert.throws(
    () => cryptoService.decrypt(encrypted),
    (error) => error.code === 'INTEGRATION_PAYLOAD_DECRYPTION_FAILED'
  );
});
