const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createNfcTapService } = require('../services/nfcTapService');
const { exchangeToken, tokenDigest, uidDigest } = require('../services/nfcIdentity');
const { scanAttestationPayload } = require('../services/nfcDeviceAttestation');

test('resolves an authenticated PWA NDEF scan into a clinical summary', async () => {
  const settings = {
    uidPepper: 'a-test-nfc-uid-pepper-that-is-long-enough',
  };
  const challengeToken = exchangeToken('org-1');
  const input = {
    challengeToken,
    publicId: 'abcdefghijklmnopqrstuvwx',
    cardToken: 'A'.repeat(43),
    uc: '04DE5F1EACC040x00003D',
    scanMode: 'PWA_NDEF',
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
    status: 'ACTIVE',
    uidHash: uidDigest(input.uc.slice(0, 14), settings.uidPepper),
    originalitySignatureHash: tokenDigest('A'.repeat(64)),
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
  const transaction = {
    async $executeRawUnsafe() {},
    nfcScanChallenge: {
      async findFirst() {
        return {
          id: 'challenge-1',
          deviceId: 'device-1',
          status: 'PENDING',
          binding,
        };
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
      async updateMany() { return { count: 1 }; },
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
  const database = {
    async $transaction(operation) { return operation(transaction); },
  };
  const service = createNfcTapService(database, {
    config: settings,
    now: () => new Date('2026-07-29T12:00:00Z'),
  });

  const result = await service.resolve(
    { actorSubjectId: 'worker-1', purpose: 'nfc-card-resolution' },
    { ...input, deviceSignature }
  );

  assert.equal(result.assurance, 'AUTHENTICATED_PWA_NDEF');
  assert.equal(result.child.id, 'child-1');
  assert.equal(result.child.identityRedacted, true);
  assert.equal(result.child.medfinetId, undefined);
  assert.equal(result.clinicalSummary.vaccination.recordedDoses, 0);
  assert.equal(result.clinicalSummary.consent.status, 'NOT_RECORDED');
  assert.equal(result.actions.clinicalRecord, undefined);
});
