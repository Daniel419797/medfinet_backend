const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EVENT_TYPES,
  EVENT_BY_CODE,
  EVENT_CODE_BY_ANCHOR_PREFIX,
  buildNote,
  eventCodeForAnchorId,
  isValidEventCode,
} = require('../services/blockchain/eventTypes');

test('registers immunization record and amendment blockchain event types', () => {
  assert.deepEqual(EVENT_TYPES.IMMUNIZATION_RECORD, {
    code: 0x09,
    category: 'clinical',
  });
  assert.deepEqual(EVENT_TYPES.IMMUNIZATION_AMEND, {
    code: 0x0A,
    category: 'clinical',
  });
  assert.equal(isValidEventCode(0x09), true);
  assert.equal(isValidEventCode(0x0A), true);
  assert.equal(buildNote(0x09, 'org-1', 'immunization-recorded:record-1:hash').note.length, 35);
});

test('maps every supported event code from a deterministic anchor prefix', () => {
  const mappedCodes = new Set(Object.values(EVENT_CODE_BY_ANCHOR_PREFIX));

  assert.deepEqual(mappedCodes, new Set(Object.keys(EVENT_BY_CODE).map(Number)));
  for (const [prefix, eventCode] of Object.entries(EVENT_CODE_BY_ANCHOR_PREFIX)) {
    assert.equal(eventCodeForAnchorId(`${prefix}example`), eventCode);
  }
  assert.equal(eventCodeForAnchorId('unsupported:example'), null);
});
