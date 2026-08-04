const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { tokenDigest } = require('./nfcIdentity');
const NTAG215_VERSION_RESPONSE = '0004040201001103';

function assertUid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{14}$/i.test(value)) {
    throw new DomainError(
      400,
      'INVALID_NTAG215_UID',
      'uid must contain the 7-byte NTAG215 UID as 14 hexadecimal characters'
    );
  }
  return value.toUpperCase();
}

function assertOriginalitySignature(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new DomainError(
      400,
      'INVALID_NTAG215_ORIGINALITY_SIGNATURE',
      'originalitySignature must contain the 32-byte READ_SIG response'
    );
  }
  return value.toUpperCase();
}

function assertNtag215Version(value) {
  if (
    typeof value !== 'string'
    || value.toUpperCase() !== NTAG215_VERSION_RESPONSE
  ) {
    throw new DomainError(
      400,
      'INVALID_NTAG215_VERSION',
      'GET_VERSION response does not identify an NXP NTAG215'
    );
  }
  return NTAG215_VERSION_RESPONSE;
}

function assertCardToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new DomainError(
      400,
      'INVALID_NFC_CARD_TOKEN',
      'cardToken must be a Medfinet-issued opaque NFC token'
    );
  }
  return value;
}

function digestMatches(value, expectedHex) {
  if (typeof expectedHex !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedHex)) {
    return false;
  }
  const actual = Buffer.from(tokenDigest(String(value || '')), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return crypto.timingSafeEqual(actual, expected);
}

function verifyPersonalizationToken(binding, suppliedToken, currentTime) {
  if (!digestMatches(suppliedToken, binding.personalizationNonceHash)) {
    throw new DomainError(
      401,
      'NFC_PERSONALIZATION_TOKEN_INVALID',
      'NFC personalization authorization is invalid'
    );
  }
  if (binding.provisioningExpiresAt <= currentTime) {
    throw new DomainError(
      410,
      'NFC_PROVISIONING_EXPIRED',
      'NFC personalization authorization has expired'
    );
  }
}

module.exports = {
  assertUid,
  assertOriginalitySignature,
  assertNtag215Version,
  assertCardToken,
  digestMatches,
  verifyPersonalizationToken,
  NTAG215_VERSION_RESPONSE,
};
