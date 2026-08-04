const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  scanAttestationPayload,
  verifyDeviceSignature,
} = require('../services/nfcDeviceAttestation');

test('verifies an Ed25519 scanner attestation over the complete NTAG215 scan', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const input = {
    challengeToken: 'b3JnLTE.random-token',
    publicId: 'abcdefghijklmnopqrstuvwx',
    cardToken: 'card-token',
    uc: '04DE5F1EACC040x00003D',
    originalitySignature: 'A'.repeat(64),
  };
  const payload = scanAttestationPayload(input);
  const signature = crypto.sign(null, payload, privateKey).toString('base64url');

  assert.doesNotThrow(() => verifyDeviceSignature(
    publicKey.export({ type: 'spki', format: 'pem' }),
    payload,
    signature
  ));
});

test('rejects a scanner signature after card data is modified', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const input = {
    challengeToken: 'b3JnLTE.random-token',
    publicId: 'abcdefghijklmnopqrstuvwx',
    cardToken: 'card-token',
    uc: '04DE5F1EACC040x00003D',
    originalitySignature: 'A'.repeat(64),
  };
  const signature = crypto
    .sign(null, scanAttestationPayload(input), privateKey)
    .toString('base64url');

  assert.throws(
    () => verifyDeviceSignature(
      publicKey.export({ type: 'spki', format: 'pem' }),
      scanAttestationPayload({ ...input, cardToken: 'modified' }),
      signature
    ),
    (error) => error.code === 'NFC_DEVICE_ATTESTATION_FAILED'
  );
});

test('verifies a browser P-256 PWA scan signature in IEEE P1363 format', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const input = {
    challengeToken: 'b3JnLTE.random-token',
    publicId: 'abcdefghijklmnopqrstuvwx',
    cardToken: 'card-token',
    uc: '04DE5F1EACC040x00003D',
    scanMode: 'PWA_NDEF',
  };
  const payload = scanAttestationPayload(input);
  const signature = crypto.sign('sha256', payload, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  assert.doesNotThrow(() => verifyDeviceSignature(
    publicKey.export({ type: 'spki', format: 'pem' }),
    payload,
    signature
  ));
});
