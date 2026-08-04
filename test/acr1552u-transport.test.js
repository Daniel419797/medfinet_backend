const assert = require('node:assert/strict');
const test = require('node:test');
const {
  Acr1552uError,
  Acr1552uTransport,
  decodeResponse,
  encodeTransparentExchange,
} = require('../station/acr1552uTransport');

const OK = Buffer.from('C0030090009000', 'hex');

function cardResponse(bytes) {
  return Buffer.concat([
    Buffer.from('C003009000', 'hex'),
    Buffer.from([0x97, bytes.length]),
    bytes,
    Buffer.from('9000', 'hex'),
  ]);
}

test('encodes an NTAG command in the documented transparent-exchange TLVs', () => {
  assert.equal(
    encodeTransparentExchange(Buffer.from('3C00', 'hex')).toString('hex').toUpperCase(),
    'FFC20001089002100095023C0000'
  );
});

test('opens a Layer 3A session, exchanges raw bytes, cycles RF, and closes', async () => {
  const apdus = [];
  const delays = [];
  const version = Buffer.from('0004040201001103', 'hex');
  const pcsc = {
    async transmit(apdu) {
      apdus.push(apdu.toString('hex').toUpperCase());
      return apdu[3] === 0x01 ? cardResponse(version) : OK;
    },
    async close() { apdus.push('PCSC_CLOSE'); },
  };
  const transport = new Acr1552uTransport({
    pcsc,
    fieldOffMs: 10,
    async delay(milliseconds) { delays.push(milliseconds); },
  });

  assert.deepEqual(await transport.transceive(Buffer.from([0x60])), version);
  await transport.cycleField();
  await transport.close();

  assert.deepEqual(apdus, [
    'FFC2000002810000',
    'FFC2000002830000',
    'FFC2000002840000',
    'FFC20002048F02000300',
    'FFC20001079002100095016000',
    'FFC2000002830000',
    'FFC2000002840000',
    'FFC20002048F02000300',
    'FFC2000002820000',
    'PCSC_CLOSE',
  ]);
  assert.deepEqual(delays, [10, 10]);
});

test('rejects reader and embedded command errors instead of returning card data', () => {
  assert.throws(
    () => decodeResponse(Buffer.from('C0030190009000', 'hex'), { cardResponse: true }),
    (error) => error instanceof Acr1552uError && error.code === 'ACR1552U_COMMAND_FAILED'
  );
  assert.throws(
    () => decodeResponse(Buffer.from('C0030090006A81', 'hex')),
    (error) => error instanceof Acr1552uError && error.code === 'ACR1552U_APDU_REJECTED'
  );
});
