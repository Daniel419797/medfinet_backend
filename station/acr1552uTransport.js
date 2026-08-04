class Acr1552uError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Acr1552uError';
    this.code = code;
  }
}

const APDU_OK = Buffer.from([0x90, 0x00]);
const START_SESSION = Buffer.from('FFC2000002810000', 'hex');
const END_SESSION = Buffer.from('FFC2000002820000', 'hex');
const RF_OFF = Buffer.from('FFC2000002830000', 'hex');
const RF_ON = Buffer.from('FFC2000002840000', 'hex');
const ISO_14443_A_LAYER_3 = Buffer.from('FFC20002048F02000300', 'hex');

function encodeTransparentExchange(command) {
  if (!Buffer.isBuffer(command) || command.length < 1 || command.length > 240) {
    throw new Acr1552uError(
      'INVALID_CARD_COMMAND',
      'Transparent card command must contain 1-240 bytes'
    );
  }
  // Flag 0x10 disables ISO 14443-4 while leaving reader CRC/parity handling on.
  const data = Buffer.concat([
    Buffer.from([0x90, 0x02, 0x10, 0x00, 0x95, command.length]),
    command,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xc2, 0x00, 0x01, data.length]),
    data,
    Buffer.from([0x00]),
  ]);
}

function parseTlvs(bytes) {
  const values = new Map();
  for (let offset = 0; offset < bytes.length;) {
    let tag = bytes[offset++];
    if ((tag & 0x1f) === 0x1f) {
      if (offset >= bytes.length) throw malformedResponse();
      tag = (tag << 8) | bytes[offset++];
    }
    if (offset >= bytes.length) throw malformedResponse();
    let length = bytes[offset++];
    if (length === 0x81) {
      if (offset >= bytes.length) throw malformedResponse();
      length = bytes[offset++];
    } else if (length > 0x81) {
      throw malformedResponse();
    }
    if (offset + length > bytes.length) throw malformedResponse();
    values.set(tag, bytes.subarray(offset, offset + length));
    offset += length;
  }
  return values;
}

function decodeResponse(response, { cardResponse = false } = {}) {
  if (!Buffer.isBuffer(response) || response.length < 7) throw malformedResponse();
  const outerStatus = response.subarray(response.length - 2);
  if (!outerStatus.equals(APDU_OK)) {
    throw new Acr1552uError(
      'ACR1552U_APDU_REJECTED',
      `ACR1552U rejected pseudo APDU with status ${outerStatus.toString('hex').toUpperCase()}`
    );
  }
  const values = parseTlvs(response.subarray(0, -2));
  const genericStatus = values.get(0xc0);
  if (
    !genericStatus
    || genericStatus.length !== 3
    || genericStatus[0] !== 0
    || genericStatus[1] !== 0x90
    || genericStatus[2] !== 0x00
  ) {
    throw new Acr1552uError(
      'ACR1552U_COMMAND_FAILED',
      `ACR1552U transparent command failed${genericStatus ? ` (${genericStatus.toString('hex').toUpperCase()})` : ''}`
    );
  }
  if (!cardResponse) return values;
  const cardBytes = values.get(0x97);
  if (!cardBytes) {
    throw new Acr1552uError('ACR1552U_CARD_RESPONSE_MISSING', 'Reader returned no card response');
  }
  return cardBytes;
}

function malformedResponse() {
  return new Acr1552uError('ACR1552U_RESPONSE_MALFORMED', 'Reader returned malformed BER-TLV data');
}

class Acr1552uTransport {
  constructor({ pcsc, fieldOffMs = 10, delay = defaultDelay }) {
    if (!pcsc?.transmit || typeof pcsc.transmit !== 'function') {
      throw new Acr1552uError(
        'INVALID_PCSC_SESSION',
        'PC/SC session must provide transmit(apdu)'
      );
    }
    if (!Number.isInteger(fieldOffMs) || fieldOffMs < 5 || fieldOffMs > 1000) {
      throw new Acr1552uError('INVALID_RF_CYCLE', 'fieldOffMs must be between 5 and 1000');
    }
    this.pcsc = pcsc;
    this.fieldOffMs = fieldOffMs;
    this.delay = delay;
    this.sessionStarted = false;
    this.closed = false;
  }

  async exchange(apdu, options) {
    if (this.closed) throw new Acr1552uError('ACR1552U_SESSION_CLOSED', 'Reader session is closed');
    return decodeResponse(await this.pcsc.transmit(apdu), options);
  }

  async start() {
    if (this.sessionStarted) return;
    await this.exchange(START_SESSION);
    this.sessionStarted = true;
    try {
      await this.selectType2();
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
  }

  async selectType2() {
    await this.exchange(RF_OFF);
    await this.delay(this.fieldOffMs);
    await this.exchange(RF_ON);
    await this.exchange(ISO_14443_A_LAYER_3);
  }

  async transceive(command) {
    await this.start();
    return this.exchange(encodeTransparentExchange(command), { cardResponse: true });
  }

  async cycleField() {
    if (!this.sessionStarted) {
      throw new Acr1552uError('ACR1552U_SESSION_NOT_STARTED', 'Cannot cycle RF before card selection');
    }
    await this.selectType2();
  }

  async close() {
    if (this.closed) return;
    if (this.sessionStarted) await this.exchange(END_SESSION);
    this.sessionStarted = false;
    this.closed = true;
    if (typeof this.pcsc.close === 'function') await this.pcsc.close();
  }
}

function defaultDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  Acr1552uError,
  Acr1552uTransport,
  decodeResponse,
  encodeTransparentExchange,
};
