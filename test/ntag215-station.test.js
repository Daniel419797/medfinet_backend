const assert = require('node:assert/strict');
const test = require('node:test');
const { buildNdefManifest, materializeNdefUrl } = require('../services/nfcNdef');
const {
  EXPECTED_VERSION_HEX,
  Ntag215Station,
  StationError,
} = require('../station/ntag215Station');

const UID = '04DE5F1EACC042';
const SIGNATURE = Buffer.alloc(32, 0xab);
const PASSWORD = '11223344';
const PACK = 'A1B2';

class Ntag215Emulator {
  constructor({ version = EXPECTED_VERSION_HEX, uid = UID } = {}) {
    this.version = Buffer.from(version, 'hex');
    this.uid = uid;
    this.memory = Buffer.alloc(135 * 4);
    this.memory[131 * 4 + 3] = 0xff;
    const uidBytes = Buffer.from(uid, 'hex');
    this.memory.set(uidBytes.subarray(0, 3), 0);
    this.memory.set(uidBytes.subarray(3), 4);
    this.password = Buffer.alloc(4, 0xff);
    this.pack = Buffer.alloc(2);
    this.authenticated = false;
    this.configurationLocked = false;
    this.fieldCycles = 0;
    this.commands = [];
  }

  readBytes(page) {
    const copy = Buffer.from(this.memory);
    const placeholder = Buffer.from('00000000000000x000000', 'ascii');
    const offset = copy.indexOf(placeholder, 4 * 4);
    if (offset >= 0 && this.memory[131 * 4] !== 0) {
      Buffer.from(`${this.uid}x000001`, 'ascii').copy(copy, offset);
    }
    return copy.subarray(page * 4, page * 4 + 16);
  }

  async transceive(command) {
    this.commands.push(command.toString('hex').toUpperCase());
    if (command[0] === 0x60) return this.version;
    if (command[0] === 0x3c) return SIGNATURE;
    if (command[0] === 0x30) return this.readBytes(command[1]);
    if (command[0] === 0x1b) {
      if (!command.subarray(1).equals(this.password)) return Buffer.from([0x00]);
      this.authenticated = true;
      return Buffer.from(this.pack);
    }
    if (command[0] === 0xa2) {
      const page = command[1];
      if (this.configurationLocked && page >= 131 && page <= 134) return Buffer.from([0x00]);
      const auth0 = this.memory[131 * 4 + 3];
      if (auth0 <= page && !this.authenticated) return Buffer.from([0x00]);
      command.subarray(2, 6).copy(this.memory, page * 4);
      if (page === 133) this.password = Buffer.from(command.subarray(2, 6));
      if (page === 134) this.pack = Buffer.from(command.subarray(2, 4));
      return Buffer.from([0x0a]);
    }
    return Buffer.from([0x00]);
  }

  async cycleField() {
    this.fieldCycles += 1;
    this.authenticated = false;
    this.configurationLocked = (this.memory[132 * 4] & 0x40) !== 0;
  }
}

function fixture() {
  const manifest = buildNdefManifest(
    'https://app.medfinet.test/nfc/tap',
    'public-card-reference',
    'A'.repeat(43)
  );
  return {
    manifest,
    access: { passwordHex: PASSWORD, packHex: PACK },
  };
}

test('inspects, personalizes, protects, and locks an exact NTAG215', async () => {
  const transport = new Ntag215Emulator();
  let originalityInput;
  const station = new Ntag215Station({
    transport,
    async verifyOriginality(input) {
      originalityInput = input;
      return input.uid === UID && input.signature.equals(SIGNATURE);
    },
  });

  const inspected = await station.inspect();
  assert.equal(inspected.versionResponse, EXPECTED_VERSION_HEX);
  assert.equal(inspected.uid, UID);
  assert.equal(inspected.originalityVerified, true);
  assert.equal(originalityInput.uid, UID);

  const result = await station.personalize({
    ...fixture(),
    inspectedUid: inspected.uid,
  });
  assert.equal(result.uid, UID);
  assert.equal(result.uc, `${UID}x000001`);
  assert.equal(
    result.ndefReadback,
    materializeNdefUrl(fixture().manifest.ndefUrlTemplate, `${UID}x000001`)
  );
  assert.equal(result.packResponseHex, PACK);
  assert.equal(result.writeProtected, true);
  assert.equal(result.configurationLocked, true);
  assert.equal(transport.fieldCycles, 1);
  assert.equal(transport.configurationLocked, true);
  assert.ok(transport.commands.includes(`1B${PASSWORD}`));
  assert.ok(transport.commands.includes('A28457000000'));
});

test('rejects a different NTAG family before reading originality evidence', async () => {
  const transport = new Ntag215Emulator({ version: '0004040201000F03' });
  const station = new Ntag215Station({
    transport,
    async verifyOriginality() { return true; },
  });
  await assert.rejects(
    station.inspect(),
    (error) => error instanceof StationError && error.code === 'UNSUPPORTED_NFC_HARDWARE'
  );
  assert.deepEqual(transport.commands, ['60']);
});

test('refuses personalization when the inspected card was swapped', async () => {
  const transport = new Ntag215Emulator();
  const station = new Ntag215Station({
    transport,
    async verifyOriginality() { return true; },
  });
  await assert.rejects(
    station.personalize({ ...fixture(), inspectedUid: '04DE5F1EACC099' }),
    (error) => error instanceof StationError && error.code === 'NTAG215_CARD_CHANGED'
  );
  assert.equal(transport.commands.some((command) => command.startsWith('A2')), false);
});
