const crypto = require('node:crypto');
const http = require('node:http');

const SUBJECT = 'nfc-http-integration-admin';
const VERSION_RESPONSE = '0004040201001103';
const UID = '04DE5F1EACC041';
const ORIGINALITY_SIGNATURE = 'B'.repeat(64);

function sign(privateKey, payload) {
  return crypto.sign(null, payload, privateKey).toString('base64url');
}

function testAccessToken(assurance = 'aal2') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: SUBJECT,
    aal: assurance,
    iat: Math.floor(Date.now() / 1000),
  })}.integration`;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
}

function createIdentityProviderStub() {
  return http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/auth/v1/user') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: SUBJECT,
        aud: 'authenticated',
        role: 'authenticated',
      }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'Not found' }));
  });
}

async function seed(prisma, publicKey) {
  const organization = await prisma.organization.create({
    data: {
      name: 'NFC HTTP integration verification',
      slug: `nfc-http-integration-${crypto.randomUUID()}`,
    },
  });
  await prisma.organizationMembership.create({
    data: {
      organizationId: organization.id,
      subjectId: SUBJECT,
      role: 'ADMIN',
    },
  });
  const child = await prisma.child.create({
    data: {
      organizationId: organization.id,
      medfinetId: `MDF-NFC-HTTP-${crypto.randomUUID()}`,
      firstName: 'HTTP',
      lastName: 'Integration',
      dateOfBirth: new Date('2025-01-01T00:00:00.000Z'),
      sex: 'FEMALE',
      createdBySubjectId: SUBJECT,
    },
  });
  const device = await prisma.fieldDevice.create({
    data: {
      organizationId: organization.id,
      subjectId: SUBJECT,
      deviceIdentifierHash: crypto.randomBytes(32).toString('hex'),
      displayName: 'NFC HTTP integration station',
      platform: 'Node verification',
      appVersion: '1.0.0',
      publicKey,
      nfcProvisioningEnabled: true,
      nfcProvisioningApprovedAt: new Date(),
      nfcProvisioningApprovedBySubjectId: SUBJECT,
    },
  });
  return { organization, child, device };
}

async function request(baseUrl, path, { token, organizationId, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(organizationId ? {
        'x-organization-id': organizationId,
        'x-access-purpose': 'nfc-integration-verification',
      } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.code || payload.message || `HTTP_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload.data;
}

async function verify() {
  const identityServer = createIdentityProviderStub();
  let apiServer;
  let prisma;
  let stage = 'start-identity-provider';
  try {
    const identityPort = await listen(identityServer);
    process.env.SUPABASE_URL = `http://127.0.0.1:${identityPort}`;

    const app = require('../app');
    ({ prisma } = require('../utils/prisma'));
    const {
      activationAttestationPayload,
      provisioningAttestationPayload,
      scanAttestationPayload,
    } = require('../services/nfcDeviceAttestation');
    const { materializeNdefUrl } = require('../services/nfcNdef');

    stage = 'start-api';
    apiServer = http.createServer(app);
    const apiPort = await listen(apiServer);
    const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
    const token = testAccessToken();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    stage = 'seed-database';
    const { organization, child, device } = await seed(prisma, publicKeyPem);
    const authorized = { token, organizationId: organization.id };

    stage = 'reject-non-step-up-http';
    let stepUpCode = null;
    try {
      await request(baseUrl, `/children/${child.id}/nfc-bindings`, {
        token: testAccessToken('aal1'),
        organizationId: organization.id,
      });
    } catch (error) {
      stepUpCode = error.payload?.code;
    }
    if (stepUpCode !== 'STEP_UP_AUTHENTICATION_REQUIRED') {
      throw new Error('NFC lifecycle did not enforce recent AAL2 authentication');
    }

    stage = 'create-draft-http';
    const draft = await request(baseUrl, `/children/${child.id}/nfc-bindings`, {
      ...authorized,
    });
    const prepareInput = {
      personalizationToken: draft.personalizationToken,
      versionResponse: VERSION_RESPONSE,
      uid: UID,
      originalitySignature: ORIGINALITY_SIGNATURE,
      originalityVerified: true,
      deviceId: device.id,
    };

    stage = 'prepare-http';
    const prepared = await request(
      baseUrl,
      `/nfc-bindings/${draft.binding.id}/prepare`,
      {
        ...authorized,
        body: {
          ...prepareInput,
          deviceSignature: sign(
            privateKey,
            provisioningAttestationPayload(draft.binding.id, prepareInput)
          ),
        },
      }
    );
    const initialUc = `${UID}x000001`;
    const activationInput = {
      personalizationToken: draft.personalizationToken,
      cardToken: draft.cardToken,
      uc: initialUc,
      ndefReadback: materializeNdefUrl(draft.manifest.ndefUrlTemplate, initialUc),
      configurationPageHex: draft.manifest.stationPlan.configurationPageHex,
      accessPageHex: draft.manifest.stationPlan.accessPageFinalHex,
      packResponseHex: prepared.access.packHex,
      writeProtected: true,
      configurationLocked: true,
      deviceId: device.id,
    };

    stage = 'activate-http';
    await request(baseUrl, `/nfc-bindings/${draft.binding.id}/activate`, {
      ...authorized,
      body: {
        ...activationInput,
        deviceSignature: sign(
          privateKey,
          activationAttestationPayload(draft.binding.id, activationInput)
        ),
      },
    });

    stage = 'recognize-public-http';
    const recognized = await request(
      baseUrl,
      `/public/nfc/taps/${draft.binding.publicId}/recognize`,
      { body: { uc: initialUc, t: draft.cardToken } }
    );

    stage = 'challenge-http';
    const challenge = await request(baseUrl, '/nfc/scans/challenges', {
      token,
      body: { publicId: draft.binding.publicId, deviceId: device.id },
    });
    const scanInput = {
      challengeToken: challenge.challengeToken,
      publicId: draft.binding.publicId,
      cardToken: draft.cardToken,
      uc: `${UID}x000002`,
      scanMode: 'PWA_NDEF',
    };

    stage = 'resolve-http';
    const resolved = await request(baseUrl, '/nfc/scans/resolve', {
      token,
      body: {
        ...scanInput,
        deviceSignature: sign(privateKey, scanAttestationPayload(scanInput)),
      },
    });

    stage = 'replay-http';
    let replayCode = null;
    try {
      await request(baseUrl, '/nfc/scans/resolve', {
        token,
        body: {
          ...scanInput,
          deviceSignature: sign(privateKey, scanAttestationPayload(scanInput)),
        },
      });
    } catch (error) {
      replayCode = error.payload?.code;
    }

    stage = 'revoke-http';
    await request(baseUrl, `/nfc-bindings/${draft.binding.id}/revoke`, {
      ...authorized,
      body: { reason: 'HTTP integration verification complete' },
    });
    const revoked = await request(
      baseUrl,
      `/public/nfc/taps/${draft.binding.publicId}/recognize`,
      { body: { uc: `${UID}x000002`, t: draft.cardToken } }
    );

    if (
      recognized.status !== 'ACTIVE'
      || resolved.assurance !== 'AUTHENTICATED_PWA_NDEF'
      || resolved.child.identityRedacted !== true
      || replayCode !== 'NFC_SCAN_CHALLENGE_NOT_FOUND'
      || revoked.status !== 'REVOKED'
    ) {
      throw new Error('NFC HTTP integration returned an unexpected result');
    }
    return {
      authenticatedLifecycle: true,
      stepUpEnforced: true,
      publicStatus: recognized.status,
      consentRedaction: 'VERIFIED',
      replayRejected: true,
      revokedStatus: revoked.status,
    };
  } catch (error) {
    error.verificationStage = stage;
    throw error;
  } finally {
    await close(apiServer).catch(() => {});
    await close(identityServer).catch(() => {});
    if (prisma) await prisma.$disconnect();
  }
}

verify()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    const reason = error.payload?.code || error.code || error.message || error.name;
    process.stderr.write(
      `NFC HTTP integration failed at ${error.verificationStage || 'unknown'}: ${reason}\n`
    );
    process.exitCode = 1;
  });
