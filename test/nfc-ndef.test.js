const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildNdefManifest,
  parseMirroredValue,
} = require('../services/nfcNdef');

test('builds an NTAG215 Type 2 URI record with UID and counter mirroring', () => {
  const manifest = buildNdefManifest(
    'https://id.example.com/nfc/tap',
    'abcdefghijklmnopqrstuvwx',
    'card-token'
  );
  const memory = Buffer.from(manifest.type2UserMemoryBase64, 'base64');

  assert.equal(memory[0], 0x03);
  assert.equal(memory.at(-1), 0xfe);
  assert.equal(manifest.hardwareFamily, 'NTAG_215');
  assert.equal(manifest.mirror.mode, 'UID_AND_COUNTER');
  assert.equal(manifest.protection.protectReads, false);
  assert.equal(manifest.protection.lockConfiguration, true);
  assert.ok(manifest.finalUserPage <= 129);
  assert.match(manifest.ndefUrlTemplate, /#uc=0{14}x0{6}&t=card-token$/);
  assert.equal(manifest.mirror.separator, 'x');
  assert.equal(manifest.stationPlan.pages.configuration, 131);
  assert.equal(manifest.stationPlan.pages.access, 132);
  assert.equal(manifest.stationPlan.pages.password, 133);
  assert.equal(manifest.stationPlan.pages.pack, 134);
  assert.match(manifest.stationPlan.configurationPageHex, /^[C-F]400[0-9A-F]{2}04$/);
  assert.equal(manifest.stationPlan.accessPageBeforeLockHex, '17000000');
  assert.equal(manifest.stationPlan.accessPageFinalHex, '57000000');
});

test('parses the mirrored UID and 24-bit counter', () => {
  assert.deepEqual(parseMirroredValue('04DE5F1EACC040x00003D'), {
    uid: '04DE5F1EACC040',
    counter: 61,
  });
});

test('rejects the non-physical 20-character mirror format', () => {
  assert.throws(
    () => parseMirroredValue('04DE5F1EACC04000003D'),
    (error) => error.code === 'INVALID_NTAG215_MIRROR'
  );
});
