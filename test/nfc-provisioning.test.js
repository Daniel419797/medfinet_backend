const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  createNfcProvisioningService,
} = require('../services/nfcProvisioningService');
const {
  createNfcActivationService,
} = require('../services/nfcActivationService');
const { tokenDigest } = require('../services/nfcIdentity');
const {
  buildNdefManifest,
  materializeNdefUrl,
} = require('../services/nfcNdef');
const {
  provisioningAttestationPayload,
  activationAttestationPayload,
} = require('../services/nfcDeviceAttestation');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

function context() {
  return {
    organizationId: 'org-1',
    actorSubjectId: 'admin-1',
    purpose: 'secure-card-provisioning',
  };
}

const settings = {
  tapBaseUrl: 'https://id.example.com/nfc/tap',
  uidPepper: 'a-test-nfc-uid-pepper-that-is-long-enough',
  provisioningSecret: 'a-test-provisioning-secret-that-is-long-enough',
  requireOriginalityAttestation: true,
};

function activationEvidence(cardToken, uc) {
  const manifest = buildNdefManifest(
    settings.tapBaseUrl,
    'abcdefghijklmnopqrstuvwx',
    cardToken
  );
  return {
    ndefReadback: materializeNdefUrl(manifest.ndefUrlTemplate, uc),
    configurationPageHex: manifest.stationPlan.configurationPageHex,
    accessPageHex: manifest.stationPlan.accessPageFinalHex,
    packResponseHex: require('../services/nfcIdentity').cardAccessCredentials(
      uc.slice(0, 14),
      'abcdefghijklmnopqrstuvwx',
      settings.provisioningSecret
    ).packHex,
  };
}

test('creates a pending NTAG215 binding with one-time provisioning material', async () => {
  const calls = [];
  const tx = {
    async $executeRawUnsafe() {},
    child: { async findFirst() { return { id: 'child-1' }; } },
    childCredential: {
      async create({ data }) {
        calls.push(['credential', data]);
        return {
          id: 'credential-1',
          childId: data.childId,
          kind: data.kind,
          status: 'ACTIVE',
          createdAt: new Date(),
        };
      },
    },
    nfcCredentialBinding: {
      async create({ data }) {
        return {
          id: 'binding-1',
          publicId: 'abcdefghijklmnopqrstuvwx',
          status: 'PENDING',
          hardwareFamily: 'NTAG_215',
          ...data,
        };
      },
    },
    nfcPublicRoute: { async create() {} },
    auditEvent: { async create() {} },
  };
  const service = createNfcProvisioningService(
    databaseWithTransaction(tx),
    { config: settings }
  );

  const result = await service.createDraft(context(), 'child-1');

  assert.equal(calls[0][1].tokenHash, tokenDigest(result.cardToken));
  assert.equal(result.manifest.hardwareFamily, 'NTAG_215');
  assert.equal(Object.hasOwn(result.binding, 'uidHash'), false);
  assert.match(result.personalizationToken, /^[A-Za-z0-9_-]{43}$/);
});

test('prepares a genuine NTAG215 and derives card-specific write credentials', async () => {
  const personalizationToken = 'one-time-personalization-token';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  let updateData;
  const tx = {
    async $executeRawUnsafe() {},
    nfcCredentialBinding: {
      async findFirst({ where }) {
        if (where.uidHash) return null;
        return {
          id: 'binding-1',
          publicId: 'abcdefghijklmnopqrstuvwx',
          credentialId: 'credential-1',
          status: 'PENDING',
          personalizationNonceHash: tokenDigest(personalizationToken),
          provisioningExpiresAt: new Date('2026-07-29T12:30:00.000Z'),
          credential: { childId: 'child-1' },
        };
      },
      async update({ data }) {
        updateData = data;
        return { id: 'binding-1', status: 'PENDING', ...data };
      },
    },
    fieldDevice: {
      async findFirst() {
        return {
          id: 'device-1',
          publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          nfcProvisioningEnabled: true,
        };
      },
    },
    auditEvent: { async create() {} },
    outboxEvent: { async create() {} },
  };
  const service = createNfcProvisioningService(
    databaseWithTransaction(tx),
    {
      config: settings,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    }
  );

  const prepareInput = {
    personalizationToken,
    versionResponse: '0004040201001103',
    uid: '04DE5F1EACC040',
    originalitySignature: 'A'.repeat(64),
    originalityVerified: true,
    deviceId: 'device-1',
  };
  const result = await service.prepare(context(), 'binding-1', {
    ...prepareInput,
    deviceSignature: crypto.sign(
      null,
      provisioningAttestationPayload('binding-1', prepareInput),
      privateKey
    ).toString('base64url'),
  });

  assert.equal(updateData.uidHash.length, 64);
  assert.equal(updateData.originalitySignatureHash.length, 64);
  assert.match(result.access.passwordHex, /^[0-9A-F]{8}$/);
  assert.match(result.access.packHex, /^[0-9A-F]{4}$/);
  assert.equal(result.protection.protectReads, false);
});

test('rejects an NTAG213 GET_VERSION response before provisioning', async () => {
  const service = createNfcProvisioningService(
    databaseWithTransaction({}),
    { config: settings }
  );

  await assert.rejects(
    service.prepare(context(), 'binding-1', {
      versionResponse: '0004040201000F03',
    }),
    (error) => error.code === 'INVALID_NTAG215_VERSION'
  );
});

test('activates only after protected read-back matches the prepared card', async () => {
  const personalizationToken = 'one-time-personalization-token';
  const cardToken = 'A'.repeat(43);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  let updateData;
  const tx = {
    async $executeRawUnsafe() {},
    nfcCredentialBinding: {
      async findFirst() {
        return {
          id: 'binding-1',
          publicId: 'abcdefghijklmnopqrstuvwx',
          credentialId: 'credential-1',
          status: 'PENDING',
          uidHash: require('../services/nfcIdentity').uidDigest(
            '04DE5F1EACC040',
            settings.uidPepper
          ),
          preparedAt: new Date(),
          originalityVerifiedAt: new Date(),
          personalizationNonceHash: tokenDigest(personalizationToken),
          provisioningExpiresAt: new Date('2026-07-29T12:30:00.000Z'),
          credential: {
            childId: 'child-1',
            tokenHash: tokenDigest(cardToken),
          },
        };
      },
      async update({ data }) {
        updateData = data;
        return { id: 'binding-1', ...data };
      },
    },
    fieldDevice: {
      async findFirst() {
        return {
          id: 'device-1',
          publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        };
      },
    },
    auditEvent: { async create() {} },
    outboxEvent: { async create() {} },
  };
  const service = createNfcActivationService(
    databaseWithTransaction(tx),
    {
      config: settings,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    }
  );

  const activationInput = {
    personalizationToken,
    cardToken,
    uc: '04DE5F1EACC040x00003D',
    writeProtected: true,
    configurationLocked: true,
    deviceId: 'device-1',
    ...activationEvidence(cardToken, '04DE5F1EACC040x00003D'),
  };
  await service.activate(context(), 'binding-1', {
    ...activationInput,
    deviceSignature: crypto.sign(
      null,
      activationAttestationPayload('binding-1', activationInput),
      privateKey
    ).toString('base64url'),
  });

  assert.equal(updateData.status, 'ACTIVE');
  assert.equal(updateData.lastCounter, 61);
  assert.ok(updateData.writeProtectedAt);
});

test('rejects activation when protected read-back was not signed by the station', async () => {
  const personalizationToken = 'one-time-personalization-token';
  const cardToken = 'A'.repeat(43);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const tx = {
    async $executeRawUnsafe() {},
    nfcCredentialBinding: {
      async findFirst() {
        return {
          id: 'binding-1',
          publicId: 'abcdefghijklmnopqrstuvwx',
          credentialId: 'credential-1',
          status: 'PENDING',
          uidHash: require('../services/nfcIdentity').uidDigest(
            '04DE5F1EACC040',
            settings.uidPepper
          ),
          preparedAt: new Date(),
          originalityVerifiedAt: new Date(),
          personalizationNonceHash: tokenDigest(personalizationToken),
          provisioningExpiresAt: new Date('2026-07-29T12:30:00.000Z'),
          credential: {
            childId: 'child-1',
            tokenHash: tokenDigest(cardToken),
          },
        };
      },
    },
    fieldDevice: {
      async findFirst() {
        return {
          id: 'device-1',
          publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        };
      },
    },
  };
  const service = createNfcActivationService(
    databaseWithTransaction(tx),
    {
      config: settings,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    }
  );
  const signed = {
    personalizationToken,
    cardToken,
    uc: '04DE5F1EACC040x00003D',
    writeProtected: true,
    configurationLocked: true,
    deviceId: 'device-1',
    ...activationEvidence(cardToken, '04DE5F1EACC040x00003D'),
  };

  await assert.rejects(
    service.activate(context(), 'binding-1', {
      ...signed,
      deviceSignature: crypto.sign(
        null,
        activationAttestationPayload('binding-1', {
          ...signed,
          ndefReadback: `${signed.ndefReadback}tampered`,
        }),
        privateKey
      ).toString('base64url'),
    }),
    (error) => error.code === 'NFC_DEVICE_ATTESTATION_FAILED'
  );
});
