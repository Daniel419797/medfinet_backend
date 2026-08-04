const EXPECTED_VERSION_HEX = '0004040201001103';
const ACK = 0x0a;
const USER_PAGE_SIZE = 4;
const READ_SIZE = 16;

class StationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StationError';
    this.code = code;
  }
}

function hex(value, name, bytes) {
  if (typeof value !== 'string' || !/^[0-9A-F]+$/i.test(value) || value.length !== bytes * 2) {
    throw new StationError('INVALID_STATION_INPUT', `${name} must contain ${bytes} bytes of hex`);
  }
  return Buffer.from(value, 'hex');
}

function responseBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new StationError('INVALID_READER_RESPONSE', 'The NFC transport returned a non-binary response');
}

function uidFromManufacturerPages(pages) {
  if (pages.length < READ_SIZE) {
    throw new StationError('INVALID_UID_RESPONSE', 'NTAG215 manufacturer-page read was truncated');
  }
  return Buffer.from([
    pages[0], pages[1], pages[2], pages[4], pages[5], pages[6], pages[7],
  ]).toString('hex').toUpperCase();
}

function userPages(manifest) {
  const memory = Buffer.from(manifest.type2UserMemoryBase64, 'base64');
  if (
    manifest.hardwareFamily !== 'NTAG_215'
    || manifest.firstUserPage !== 4
    || memory.length < 1
    || memory.length > 504
  ) {
    throw new StationError('INVALID_NTAG215_MANIFEST', 'The backend manifest is not a bounded NTAG215 image');
  }
  const paddedLength = Math.ceil(memory.length / USER_PAGE_SIZE) * USER_PAGE_SIZE;
  return {
    memory,
    padded: Buffer.concat([memory, Buffer.alloc(paddedLength - memory.length)]),
  };
}

class Ntag215Station {
  constructor({ transport, verifyOriginality }) {
    if (!transport?.transceive || !transport?.cycleField) {
      throw new StationError(
        'INVALID_NFC_TRANSPORT',
        'Transport must provide transceive(command) and cycleField()'
      );
    }
    if (typeof verifyOriginality !== 'function') {
      throw new StationError(
        'ORIGINALITY_VERIFIER_REQUIRED',
        'An approved NXP originality-signature verifier is required'
      );
    }
    this.transport = transport;
    this.verifyOriginality = verifyOriginality;
  }

  async command(bytes, expectedLength, code) {
    const response = responseBuffer(await this.transport.transceive(Buffer.from(bytes)));
    if (expectedLength != null && response.length !== expectedLength) {
      throw new StationError(code, `Unexpected NTAG215 response length: ${response.length}`);
    }
    return response;
  }

  async read(startPage) {
    return this.command([0x30, startPage], READ_SIZE, 'NTAG215_READ_FAILED');
  }

  async write(page, bytes) {
    if (!Number.isInteger(page) || page < 0 || page > 255 || bytes.length !== USER_PAGE_SIZE) {
      throw new StationError('INVALID_PAGE_WRITE', 'NTAG215 WRITE requires one four-byte page');
    }
    const response = await this.command(
      Buffer.concat([Buffer.from([0xa2, page]), bytes]),
      1,
      'NTAG215_WRITE_FAILED'
    );
    if (response[0] !== ACK) {
      throw new StationError('NTAG215_WRITE_REJECTED', `NTAG215 rejected page ${page}`);
    }
  }

  async authenticate(password, expectedPack) {
    const response = await this.command(
      Buffer.concat([Buffer.from([0x1b]), password]),
      2,
      'NTAG215_AUTHENTICATION_FAILED'
    );
    if (!cryptoSafeEqual(response, expectedPack)) {
      throw new StationError('NTAG215_PACK_MISMATCH', 'NTAG215 returned an unexpected PACK');
    }
  }

  async inspect() {
    const version = await this.command([0x60], 8, 'NTAG215_VERSION_READ_FAILED');
    const versionHex = version.toString('hex').toUpperCase();
    if (versionHex !== EXPECTED_VERSION_HEX) {
      throw new StationError('UNSUPPORTED_NFC_HARDWARE', 'Card is not an exact NTAG215');
    }
    const manufacturerPages = await this.read(0);
    const uid = uidFromManufacturerPages(manufacturerPages);
    const signature = await this.command([0x3c, 0x00], 32, 'NTAG215_SIGNATURE_READ_FAILED');
    const verified = await this.verifyOriginality({ uid, signature, version });
    if (verified !== true) {
      throw new StationError('NTAG215_ORIGINALITY_FAILED', 'NXP originality verification failed');
    }
    return {
      versionResponse: versionHex,
      uid,
      originalitySignature: signature.toString('hex').toUpperCase(),
      originalityVerified: true,
    };
  }

  async personalize({ manifest, access, inspectedUid }) {
    const plan = manifest?.stationPlan;
    const image = userPages(manifest);
    const password = hex(access?.passwordHex, 'passwordHex', 4);
    const pack = hex(access?.packHex, 'packHex', 2);
    const configuration = hex(plan?.configurationPageHex, 'configurationPageHex', 4);
    const accessBeforeLock = hex(plan?.accessPageBeforeLockHex, 'accessPageBeforeLockHex', 4);
    const accessFinal = hex(plan?.accessPageFinalHex, 'accessPageFinalHex', 4);
    assertPlan(plan);

    const currentUid = uidFromManufacturerPages(await this.read(0));
    if (currentUid !== inspectedUid) {
      throw new StationError('NTAG215_CARD_CHANGED', 'The card changed after originality inspection');
    }
    for (let offset = 0; offset < image.padded.length; offset += USER_PAGE_SIZE) {
      await this.write(manifest.firstUserPage + offset / USER_PAGE_SIZE, image.padded.subarray(offset, offset + 4));
    }
    await this.write(plan.pages.password, password);
    await this.write(plan.pages.pack, Buffer.concat([pack, Buffer.alloc(2)]));
    await this.write(plan.pages.configuration, configuration);
    await this.authenticate(password, pack);
    await this.write(plan.pages.access, accessBeforeLock);

    const readback = await this.readUserMemory(manifest.firstUserPage, image.padded.length);
    assertUserMemory(
      readback.subarray(0, image.memory.length),
      image.memory,
      inspectedUid
    );
    await this.write(plan.pages.access, accessFinal);
    await this.transport.cycleField();

    await this.authenticate(password, pack);
    const configurationReadback = await this.read(plan.pages.configuration);
    if (
      !cryptoSafeEqual(configurationReadback.subarray(0, 4), configuration)
      || !cryptoSafeEqual(configurationReadback.subarray(4, 8), accessFinal)
    ) {
      throw new StationError('NTAG215_CONFIGURATION_MISMATCH', 'Locked configuration readback differs');
    }
    await this.assertConfigurationLocked(plan.pages.configuration, configuration);
    const finalReadback = await this.readUserMemory(manifest.firstUserPage, image.padded.length);
    const mirroredValue = assertUserMemory(
      finalReadback.subarray(0, image.memory.length),
      image.memory,
      inspectedUid
    );
    return {
      uid: inspectedUid,
      uc: mirroredValue,
      ndefReadback: extractUriNdef(finalReadback.subarray(0, image.memory.length)),
      ndefUserMemoryHex: finalReadback.subarray(0, image.memory.length).toString('hex').toUpperCase(),
      configurationPageHex: configuration.toString('hex').toUpperCase(),
      accessPageHex: accessFinal.toString('hex').toUpperCase(),
      packResponseHex: pack.toString('hex').toUpperCase(),
      writeProtected: true,
      configurationLocked: true,
    };
  }

  async readUserMemory(firstPage, byteLength) {
    const chunks = [];
    for (let offset = 0; offset < byteLength; offset += READ_SIZE) {
      chunks.push(await this.read(firstPage + offset / USER_PAGE_SIZE));
    }
    return Buffer.concat(chunks).subarray(0, byteLength);
  }

  async assertConfigurationLocked(page, configuration) {
    const response = responseBuffer(await this.transport.transceive(
      Buffer.concat([Buffer.from([0xa2, page]), configuration])
    ));
    if (response.length === 1 && response[0] === ACK) {
      throw new StationError('NTAG215_CONFIGURATION_NOT_LOCKED', 'Configuration remained writable after CFGLCK');
    }
  }

  async close() {
    if (typeof this.transport.close === 'function') await this.transport.close();
  }
}

function extractUriNdef(memory) {
  if (
    memory.length < 9
    || memory[0] !== 0x03
    || memory[2] !== 0xd1
    || memory[3] !== 0x01
    || memory[5] !== 0x55
    || memory[6] !== 0x00
  ) {
    throw new StationError('NTAG215_NDEF_MISMATCH', 'Card does not contain the authorized URI NDEF record');
  }
  const messageLength = memory[1];
  const payloadLength = memory[4];
  const messageEnd = 2 + messageLength;
  if (
    messageLength !== payloadLength + 4
    || messageEnd >= memory.length
    || memory[messageEnd] !== 0xfe
  ) {
    throw new StationError('NTAG215_NDEF_MISMATCH', 'URI NDEF length or terminator is invalid');
  }
  return memory.subarray(7, 7 + payloadLength - 1).toString('utf8');
}

function assertPlan(plan) {
  if (
    plan?.writeCommand !== 'A2'
    || plan?.readSignatureCommand !== '3C00'
    || plan?.pages?.configuration !== 131
    || plan?.pages?.access !== 132
    || plan?.pages?.password !== 133
    || plan?.pages?.pack !== 134
    || plan?.irreversibleConfigurationLock !== true
  ) {
    throw new StationError('INVALID_NTAG215_STATION_PLAN', 'Station plan does not match NTAG215 security pages');
  }
}

function assertUserMemory(actual, expected, expectedUid) {
  const placeholder = Buffer.from('00000000000000x000000', 'ascii');
  const offset = expected.indexOf(placeholder);
  if (offset < 0) {
    throw new StationError('INVALID_NTAG215_MANIFEST', 'NDEF image has no UID/counter mirror placeholder');
  }
  const mirrored = actual.subarray(offset, offset + placeholder.length).toString('ascii');
  if (!/^[0-9A-F]{14}x[0-9A-F]{6}$/.test(mirrored)) {
    throw new StationError('NTAG215_MIRROR_MISMATCH', 'UID/counter mirror is malformed');
  }
  const stableActual = Buffer.from(actual);
  placeholder.copy(stableActual, offset);
  if (!cryptoSafeEqual(stableActual, expected)) {
    throw new StationError('NTAG215_NDEF_MISMATCH', 'NDEF readback differs from the authorized image');
  }
  if (mirrored.slice(0, 14) !== expectedUid) {
    throw new StationError('NTAG215_MIRROR_MISMATCH', 'Mirrored UID does not match the expected UID');
  }
  return mirrored;
}

function cryptoSafeEqual(left, right) {
  return left.length === right.length && require('node:crypto').timingSafeEqual(left, right);
}

module.exports = {
  EXPECTED_VERSION_HEX,
  Ntag215Station,
  StationError,
  extractUriNdef,
  uidFromManufacturerPages,
};
