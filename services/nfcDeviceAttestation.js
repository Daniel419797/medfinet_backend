const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { TAGWRITER_DEMO_SCAN_MODE } = require('./nfcTagWriter');

function scannerPayload(kind, values) {
  return Buffer.from([kind, ...values].join('\n'), 'utf8');
}

function scanAttestationPayload(input) {
  const scanMode = input.scanMode === 'PWA_NDEF'
    ? 'PWA_NDEF'
    : input.scanMode === TAGWRITER_DEMO_SCAN_MODE
      ? TAGWRITER_DEMO_SCAN_MODE
      : 'NATIVE_RAW';
  return scannerPayload('MEDFINET_NTAG215_SCAN_V2', [
    input.challengeToken,
    input.publicId,
    input.cardToken,
    scanMode === TAGWRITER_DEMO_SCAN_MODE
      ? 'NO_UID_COUNTER_MIRROR'
      : input.uc,
    scanMode,
    scanMode === 'NATIVE_RAW'
      ? input.originalitySignature.toUpperCase()
      : 'NO_RAW_CHIP_ATTESTATION',
  ]);
}

function provisioningAttestationPayload(bindingId, input) {
  return scannerPayload('MEDFINET_NTAG215_PROVISION_V3', [
    bindingId,
    input.personalizationToken,
    input.versionResponse.toUpperCase(),
    input.uid.toUpperCase(),
    input.originalitySignature.toUpperCase(),
    input.originalityVerified === true
      ? 'ORIGINALITY_VERIFIED'
      : 'ORIGINALITY_NOT_VERIFIED',
  ]);
}

function activationAttestationPayload(bindingId, input) {
  return scannerPayload('MEDFINET_NTAG215_ACTIVATE_V2', [
    bindingId,
    input.personalizationToken,
    input.cardToken,
    input.uc.toUpperCase(),
    input.ndefReadback,
    input.configurationPageHex.toUpperCase(),
    input.accessPageHex.toUpperCase(),
    input.packResponseHex.toUpperCase(),
    input.writeProtected === true ? 'WRITE_PROTECTED' : 'WRITE_NOT_PROTECTED',
    input.configurationLocked === true
      ? 'CONFIGURATION_LOCKED'
      : 'CONFIGURATION_NOT_LOCKED',
  ]);
}

function verifyDeviceSignature(publicKey, payload, signature) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    throw new DomainError(
      400,
      'INVALID_NFC_DEVICE_SIGNATURE',
      'deviceSignature must be base64url encoded'
    );
  }
  let key;
  try {
    key = crypto.createPublicKey(publicKey);
  } catch {
    throw new DomainError(
      409,
      'NFC_DEVICE_KEY_INVALID',
      'Registered scanner public key is invalid'
    );
  }
  const isEd25519 = key.asymmetricKeyType === 'ed25519';
  const isP256 = key.asymmetricKeyType === 'ec'
    && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  if (!isEd25519 && !isP256) {
    throw new DomainError(
      409,
      'NFC_DEVICE_KEY_UNSUPPORTED',
      'NFC scanners must use an Ed25519 or hardware-backed P-256 key'
    );
  }
  const signatureBytes = Buffer.from(signature, 'base64url');
  const verified = isEd25519
    ? crypto.verify(null, payload, key, signatureBytes)
    : crypto.verify(
      'sha256',
      payload,
      { key, dsaEncoding: signatureBytes.length === 64 ? 'ieee-p1363' : 'der' },
      signatureBytes
    );
  if (!verified) {
    throw new DomainError(
      401,
      'NFC_DEVICE_ATTESTATION_FAILED',
      'NFC scanner attestation is invalid'
    );
  }
}

module.exports = {
  scanAttestationPayload,
  provisioningAttestationPayload,
  activationAttestationPayload,
  verifyDeviceSignature,
};
