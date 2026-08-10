const crypto = require('node:crypto');

const NOTE_VERSION = 0x0001;
const VERSION_BYTES = 2;
const TYPE_BYTE = 1;
const HASH_BYTES = 32;
const NONCE_BYTES = 8;

const EVENT_TYPES = Object.freeze({
  CONSENT_GRANT:       { code: 0x01, category: 'consent' },
  CONSENT_WITHDRAWAL:  { code: 0x02, category: 'consent' },
  EMERGENCY_ACCESS:    { code: 0x03, category: 'governance' },
  IDENTITY_AMENDMENT:  { code: 0x04, category: 'governance' },
  SUBJECT_REQUEST:     { code: 0x05, category: 'governance' },
  NFC_ACTIVATE:        { code: 0x06, category: 'nfc' },
  NFC_REVOKE:          { code: 0x07, category: 'nfc' },
  NFC_REPLACE:         { code: 0x08, category: 'nfc' },
  IMMUNIZATION_RECORD: { code: 0x09, category: 'clinical' },
  IMMUNIZATION_AMEND:  { code: 0x0A, category: 'clinical' },
});

const EVENT_BY_CODE = Object.values(EVENT_TYPES).reduce((map, entry) => {
  map[entry.code] = entry;
  return map;
}, {});

function isValidEventCode(code) {
  return Number.isInteger(code) && Boolean(EVENT_BY_CODE[code]);
}

function buildNote(eventCode, tenantId, anchorId) {
  if (!isValidEventCode(eventCode)) {
    throw new Error(`Invalid event code: ${eventCode}`);
  }
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const hashInput = `${tenantId}|${anchorId}|${timestamp}|${nonce.toString('hex')}`;
  const hash = crypto.createHash('sha256').update(hashInput).digest();

  const note = Buffer.alloc(VERSION_BYTES + TYPE_BYTE + HASH_BYTES);
  note.writeUInt16BE(NOTE_VERSION, 0);
  note[VERSION_BYTES] = eventCode;
  hash.copy(note, VERSION_BYTES + TYPE_BYTE);

  return { note, timestamp, nonce: nonce.toString('hex'), hash: hash.toString('hex') };
}

function verifyHash(eventCode, tenantId, anchorId, timestamp, nonceHex, expectedHash) {
  const hashInput = `${tenantId}|${anchorId}|${timestamp}|${nonceHex}`;
  const computed = crypto.createHash('sha256').update(hashInput).digest('hex');
  return computed === expectedHash;
}

module.exports = {
  NOTE_VERSION,
  VERSION_BYTES,
  TYPE_BYTE,
  HASH_BYTES,
  NONCE_BYTES,
  EVENT_TYPES,
  EVENT_BY_CODE,
  isValidEventCode,
  buildNote,
  verifyHash,
};
