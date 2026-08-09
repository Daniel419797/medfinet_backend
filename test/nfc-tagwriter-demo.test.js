const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createNfcProvisioningService } = require('../services/nfcProvisioningService');
const { createNfcPublicTapService } = require('../services/nfcPublicTapService');
const { createNfcTapService } = require('../services/nfcTapService');
const { scanAttestationPayload } = require('../services/nfcDeviceAttestation');
const { exchangeToken, tokenDigest } = require('../services/nfcIdentity');
const {
  TAGWRITER_DEMO_HARDWARE_FAMILY,
  TAGWRITER_DEMO_SCAN_MODE,
} = require('../services/nfcTagWriter');

function databaseWithTransaction(transaction, extra = {}) {
  return {
    ...extra,
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

const settings = {
  tapBaseUrl: 'https://app.example.com/nfc/tap',
  uidPepper: 'a-test-nfc-uid-pepper-that-is-long-enough',
  provisioningSecret: 'a-test-provisioning-secret-that-is-long-enough',
  requireOriginalityAttestation: true,
};

test('issues an active TagWriter demo URL without child data in the payload', async () => {
  let activation;
  const transaction = {
    async $executeRawUnsafe() {},
    child: { async findFirst() { return { id: 'child-1' }; } },
    childCredential: {
      async create({ data }) {
        return {
          id: 'credential-1',
          childId: data.childId,
          kind: data.kind,
          status: 'ACTIVE',
          createdAt: new Date('2026-08-09T12:00:00Z'),
        };
      },
    },
    nfcCredentialBinding: {
      async create({ data }) {
        return { id: 'binding-1', status: 'PENDING', ...data };
      },
      async update({ data }) {
        activation = data;
        return {
          id: 'binding-1',
          publicId: 'abcdefghijklmnopqrstuvwx',
          createdAt: new Date('2026-08-09T12:00:00Z'),
          ...data,
        };
      },
    },
    nfcPublicRoute: { async create() {} },
    auditEvent: { async create() {} },
  };
  const service = createNfcProvisioningService(
    databaseWithTransaction(transaction),
    {
      config: settings,
      now: () => new Date('2026-08-09T12:00:00Z'),
    }
  );

  const result = await service.createTagWriterDemo(
    {
      organizationId: 'org-1',
      actorSubjectId: 'admin-1',
      purpose: 'tagwriter-demo-card-provisioning',
    },
    'child-1'
  );

  const url = new URL(result.tagWriterUrl);
  assert.equal(url.origin, 'https://app.example.com');
  assert.match(url.pathname, /^\/nfc\/tap\/[A-Za-z0-9_-]{24}$/);
  assert.match(new URLSearchParams(url.hash.slice(1)).get('t'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.tagWriterUrl.includes('child-1'), false);
  assert.equal(activation.hardwareFamily, TAGWRITER_DEMO_HARDWARE_FAMILY);
  assert.equal(activation.status, 'ACTIVE');
});

test('recognizes a TagWriter demo URL without requiring a UID mirror', async () => {
  const binding = {
    id: 'binding-1',
    status: 'ACTIVE',
    hardwareFamily: TAGWRITER_DEMO_HARDWARE_FAMILY,
    originalityVerifiedAt: null,
    credential: { status: 'ACTIVE', expiresAt: null },
  };
  const transaction = {
    async $executeRawUnsafe() {},
    nfcCredentialBinding: { async findFirst() { return binding; } },
  };
  const service = createNfcPublicTapService(
    databaseWithTransaction(transaction, {
      nfcPublicRoute: {
        async findUnique() {
          return {
            publicId: 'abcdefghijklmnopqrstuvwx',
            organizationId: 'org-1',
            bindingId: 'binding-1',
          };
        },
      },
    }),
    { config: settings }
  );

  const result = await service.verifyPublicTap(
    'abcdefghijklmnopqrstuvwx',
    { uc: '', t: 'A'.repeat(43) }
  );

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.assurance, 'BASIC_STATIC_NDEF_DEMO');
  assert.equal('child' in result, false);
});

test('resolves a TagWriter demo card only through an authenticated signed challenge', async () => {
  const challengeToken = exchangeToken('org-1');
  const input = {
    challengeToken,
    publicId: 'abcdefghijklmnopqrstuvwx',
    cardToken: 'A'.repeat(43),
    uc: '',
    scanMode: TAGWRITER_DEMO_SCAN_MODE,
  };
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const deviceSignature = crypto.sign(
    'sha256',
    scanAttestationPayload(input),
    { key: privateKey, dsaEncoding: 'ieee-p1363' }
  ).toString('base64url');
  const child = {
    id: 'child-1',
    medfinetId: 'MDF-001',
    firstName: 'Ada',
    lastName: 'Nwosu',
    dateOfBirth: new Date('2025-01-01'),
    sex: 'FEMALE',
    status: 'ACTIVE',
  };
  const binding = {
    id: 'binding-1',
    organizationId: 'org-1',
    publicId: input.publicId,
    hardwareFamily: TAGWRITER_DEMO_HARDWARE_FAMILY,
    status: 'ACTIVE',
    credentialId: 'credential-1',
    credential: {
      id: 'credential-1',
      childId: child.id,
      kind: 'NFC',
      status: 'ACTIVE',
      tokenHash: tokenDigest(input.cardToken),
      expiresAt: null,
      child,
    },
  };
  let counterUpdateAttempted = false;
  const transaction = {
    async $executeRawUnsafe() {},
    nfcScanChallenge: {
      async findFirst() {
        return { id: 'challenge-1', deviceId: 'device-1', binding };
      },
      async updateMany() { return { count: 1 }; },
    },
    fieldDevice: {
      async findFirst() {
        return {
          id: 'device-1',
          publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
        };
      },
      async update() {},
    },
    organizationMembership: {
      async findUnique() { return { status: 'ACTIVE', role: 'HEALTH_WORKER' }; },
    },
    nfcCredentialBinding: {
      async updateMany() {
        counterUpdateAttempted = true;
        return { count: 1 };
      },
    },
    credentialScan: { async create() {} },
    childCredential: { async update() {} },
    auditEvent: { async create() {} },
    allergyRecord: { async findMany() { return []; } },
    immunizationRecord: { async findMany() { return []; } },
    vaccineScheduleRule: { async findMany() { return []; } },
    consentGrant: { async findMany() { return []; } },
    disclosureEvent: { async create() {} },
  };
  const service = createNfcTapService(databaseWithTransaction(transaction), {
    config: settings,
    now: () => new Date('2026-08-09T12:00:00Z'),
  });

  const result = await service.resolve(
    { actorSubjectId: 'worker-1', purpose: 'nfc-card-resolution' },
    { ...input, deviceSignature }
  );

  assert.equal(result.assurance, 'AUTHENTICATED_STATIC_NDEF_DEMO');
  assert.equal(result.child.identityRedacted, true);
  assert.equal(counterUpdateAttempted, false);
  assert.match(result.limitations[0], /can be copied/);
});
