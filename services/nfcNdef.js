const { DomainError } = require('../utils/domainError');

// NTAG21x inserts a literal ASCII "x" between its 14-character UID and
// 6-character counter when both mirrors are enabled (21 bytes total).
const UID_COUNTER_PLACEHOLDER = `${'0'.repeat(14)}x${'0'.repeat(6)}`;
const NTAG215_FIRST_USER_PAGE = 4;
const NTAG215_LAST_USER_PAGE = 129;
const NTAG215_CONFIGURATION_PAGE = 131;
const NTAG215_ACCESS_PAGE = 132;
const NTAG215_PASSWORD_PAGE = 133;
const NTAG215_PACK_PAGE = 134;

function buildUriNdefMessage(url) {
  const urlBytes = Buffer.from(url, 'utf8');
  const payloadLength = 1 + urlBytes.length;
  if (payloadLength > 255) {
    throw new DomainError(
      500,
      'NFC_NDEF_TEMPLATE_TOO_LONG',
      'Configured NFC tap URL is too long for an NTAG215 short URI record'
    );
  }
  return Buffer.concat([
    Buffer.from([0xd1, 0x01, payloadLength, 0x55, 0x00]),
    urlBytes,
  ]);
}

function buildType2UserMemory(url) {
  const message = buildUriNdefMessage(url);
  return Buffer.concat([
    Buffer.from([0x03, message.length]),
    message,
    Buffer.from([0xfe]),
  ]);
}

function buildNdefManifest(tapBaseUrl, publicId, cardToken) {
  const url = `${tapBaseUrl.replace(/\/$/, '')}/${publicId}`
    + `#uc=${UID_COUNTER_PLACEHOLDER}&t=${cardToken}`;
  const userMemory = buildType2UserMemory(url);
  const placeholderOffset = userMemory.indexOf(UID_COUNTER_PLACEHOLDER);
  const absoluteOffset = NTAG215_FIRST_USER_PAGE * 4 + placeholderOffset;
  const mirrorPage = Math.floor(absoluteOffset / 4);
  const mirrorByte = absoluteOffset % 4;
  // MIRROR_CONF=11b (UID + counter), MIRROR_BYTE in bits 5..4 and
  // STRG_MOD_EN=1. RFUI bits remain zero.
  const mirrorConfigurationByte = 0xc4 | (mirrorByte << 4);
  const finalPage = Math.ceil(
    (NTAG215_FIRST_USER_PAGE * 4 + userMemory.length) / 4
  ) - 1;
  if (finalPage > NTAG215_LAST_USER_PAGE) {
    throw new DomainError(
      500,
      'NFC_NDEF_TEMPLATE_TOO_LONG',
      'NFC URL exceeds NTAG215 user memory'
    );
  }
  return {
    hardwareFamily: 'NTAG_215',
    ndefUrlTemplate: url,
    type2UserMemoryHex: userMemory.toString('hex').toUpperCase(),
    type2UserMemoryBase64: userMemory.toString('base64'),
    firstUserPage: NTAG215_FIRST_USER_PAGE,
    finalUserPage: finalPage,
    mirror: {
      mode: 'UID_AND_COUNTER',
      page: mirrorPage,
      byte: mirrorByte,
      uidCharacters: 14,
      separator: 'x',
      counterCharacters: 6,
      counterEncoding: 'HEX_BIG_ENDIAN_TEXT',
    },
    protection: {
      protectWritesFromPage: NTAG215_FIRST_USER_PAGE,
      protectReads: false,
      enableCounter: true,
      protectCounterReads: false,
      authenticationAttemptLimit: 7,
      lockConfiguration: true,
      permanentlyLockUserMemory: false,
    },
    stationPlan: {
      specification: 'NXP_NTAG213_215_216_REV_3_2',
      writeCommand: 'A2',
      readSignatureCommand: '3C00',
      pages: {
        configuration: NTAG215_CONFIGURATION_PAGE,
        access: NTAG215_ACCESS_PAGE,
        password: NTAG215_PASSWORD_PAGE,
        pack: NTAG215_PACK_PAGE,
      },
      configurationPageHex: Buffer.from([
        mirrorConfigurationByte,
        0x00,
        mirrorPage,
        NTAG215_FIRST_USER_PAGE,
      ]).toString('hex').toUpperCase(),
      accessPageBeforeLockHex: '17000000',
      accessPageFinalHex: '57000000',
      passwordAndPackByteOrder: 'WRITE_EXACT_HEX_BYTES_LSB_FIRST',
      requiresFieldRemovalBeforeLockVerification: true,
      irreversibleConfigurationLock: true,
    },
    memoryBytesUsed: userMemory.length,
    memoryBytesAvailable: 504,
  };
}

function parseMirroredValue(value) {
  if (typeof value !== 'string' || !/^[0-9A-F]{14}x[0-9A-F]{6}$/.test(value)) {
    throw new DomainError(
      400,
      'INVALID_NTAG215_MIRROR',
      'uc must contain the 14-character UID, x separator, and 6-character NFC counter'
    );
  }
  return {
    uid: value.slice(0, 14).toUpperCase(),
    counter: Number.parseInt(value.slice(15), 16),
  };
}

function materializeNdefUrl(template, mirroredValue) {
  parseMirroredValue(mirroredValue);
  if (
    typeof template !== 'string'
    || template.split(UID_COUNTER_PLACEHOLDER).length !== 2
  ) {
    throw new DomainError(
      500,
      'NFC_NDEF_TEMPLATE_INVALID',
      'NFC NDEF template does not contain one UID/counter mirror placeholder'
    );
  }
  return template.replace(UID_COUNTER_PLACEHOLDER, mirroredValue);
}

module.exports = {
  buildNdefManifest,
  buildType2UserMemory,
  parseMirroredValue,
  materializeNdefUrl,
};
