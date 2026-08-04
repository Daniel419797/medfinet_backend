const crypto = require('node:crypto');
const { prisma } = require('../utils/prisma');
const { createNfcProvisioningService } = require('../services/nfcProvisioningService');
const { createNfcActivationService } = require('../services/nfcActivationService');
const { createNfcPublicTapService } = require('../services/nfcPublicTapService');
const { createNfcTapService } = require('../services/nfcTapService');
const {
  activationAttestationPayload,
  provisioningAttestationPayload,
  scanAttestationPayload,
} = require('../services/nfcDeviceAttestation');
const { cardAccessCredentials } = require('../services/nfcIdentity');
const { materializeNdefUrl } = require('../services/nfcNdef');

const ADMIN_SUBJECT = 'nfc-integration-admin';
const VERSION_RESPONSE = '0004040201001103';
const UID = '04DE5F1EACC040';
const ORIGINALITY_SIGNATURE = 'A'.repeat(64);

function context(organizationId, purpose = 'secure-card-provisioning') {
  return {
    organizationId,
    actorSubjectId: ADMIN_SUBJECT,
    role: 'ADMIN',
    purpose,
  };
}

function sign(privateKey, payload) {
  return crypto.sign(null, payload, privateKey).toString('base64url');
}

async function seed(publicKey) {
  const organization = await prisma.organization.create({
    data: {
      name: 'NFC integration verification',
      slug: `nfc-integration-${crypto.randomUUID()}`,
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: {
      organizationId: organization.id,
      subjectId: ADMIN_SUBJECT,
      role: 'ADMIN',
    },
  });
  const child = await prisma.child.create({
    data: {
      organizationId: organization.id,
      medfinetId: `MDF-NFC-${crypto.randomUUID()}`,
      firstName: 'Integration',
      lastName: 'Child',
      dateOfBirth: new Date('2025-01-01T00:00:00.000Z'),
      sex: 'FEMALE',
      createdBySubjectId: ADMIN_SUBJECT,
    },
  });
  const device = await prisma.fieldDevice.create({
    data: {
      organizationId: organization.id,
      subjectId: ADMIN_SUBJECT,
      deviceIdentifierHash: crypto.randomBytes(32).toString('hex'),
      displayName: 'NFC integration station',
      platform: 'Node verification',
      appVersion: '1.0.0',
      publicKey,
      nfcProvisioningEnabled: true,
      nfcProvisioningApprovedAt: new Date(),
      nfcProvisioningApprovedBySubjectId: ADMIN_SUBJECT,
    },
  });
  return { organization, membership, child, device };
}

async function verify() {
  let stage = 'generate-device-key';
  try {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  stage = 'seed-database';
  const { organization, child, device } = await seed(publicKeyPem);
  const provisioning = createNfcProvisioningService(prisma);
  const activation = createNfcActivationService(prisma);
  const publicTap = createNfcPublicTapService(prisma);
  const tap = createNfcTapService(prisma);
  const adminContext = context(organization.id);

  stage = 'create-draft';
  const draft = await provisioning.createDraft(adminContext, child.id);
  const prepareInput = {
    personalizationToken: draft.personalizationToken,
    versionResponse: VERSION_RESPONSE,
    uid: UID,
    originalitySignature: ORIGINALITY_SIGNATURE,
    originalityVerified: true,
    deviceId: device.id,
  };
  stage = 'prepare-card';
  const prepared = await provisioning.prepare(adminContext, draft.binding.id, {
    ...prepareInput,
    deviceSignature: sign(
      privateKey,
      provisioningAttestationPayload(draft.binding.id, prepareInput)
    ),
  });

  const initialUc = `${UID}x000001`;
  const access = cardAccessCredentials(
    UID,
    draft.binding.publicId,
    require('../config').nfc.provisioningSecret
  );
  const activationInput = {
    personalizationToken: draft.personalizationToken,
    cardToken: draft.cardToken,
    uc: initialUc,
    ndefReadback: materializeNdefUrl(draft.manifest.ndefUrlTemplate, initialUc),
    configurationPageHex: draft.manifest.stationPlan.configurationPageHex,
    accessPageHex: draft.manifest.stationPlan.accessPageFinalHex,
    packResponseHex: access.packHex,
    writeProtected: true,
    configurationLocked: true,
    deviceId: device.id,
  };
  stage = 'activate-card';
  await activation.activate(adminContext, draft.binding.id, {
    ...activationInput,
    deviceSignature: sign(
      privateKey,
      activationAttestationPayload(draft.binding.id, activationInput)
    ),
  });

  stage = 'verify-public-tap';
  const recognized = await publicTap.verifyPublicTap(draft.binding.publicId, {
    uc: initialUc,
    t: draft.cardToken,
  });
  const workerContext = {
    actorSubjectId: ADMIN_SUBJECT,
    purpose: 'nfc-card-resolution',
  };
  stage = 'create-scan-challenge';
  const challenge = await tap.createChallenge(workerContext, {
    publicId: draft.binding.publicId,
    deviceId: device.id,
  });
  const scanInput = {
    challengeToken: challenge.challengeToken,
    publicId: draft.binding.publicId,
    cardToken: draft.cardToken,
    uc: `${UID}x000002`,
    scanMode: 'PWA_NDEF',
  };
  stage = 'resolve-authenticated-tap';
  const resolved = await tap.resolve(workerContext, {
    ...scanInput,
    deviceSignature: sign(privateKey, scanAttestationPayload(scanInput)),
  });
  let replayRejected = false;
  try {
    await tap.resolve(workerContext, {
      ...scanInput,
      deviceSignature: sign(privateKey, scanAttestationPayload(scanInput)),
    });
  } catch (error) {
    replayRejected = error.code === 'NFC_SCAN_CHALLENGE_NOT_FOUND';
  }
  stage = 'revoke-card';
  await provisioning.revoke(adminContext, draft.binding.id, {
    reason: 'Integration verification complete',
  });
  const revoked = await publicTap.verifyPublicTap(draft.binding.publicId, {
    uc: `${UID}x000002`,
    t: draft.cardToken,
  });

  if (
    recognized.status !== 'ACTIVE'
    || prepared.binding.preparedAt == null
    || resolved.assurance !== 'AUTHENTICATED_PWA_NDEF'
    || resolved.child.identityRedacted !== true
    || !replayRejected
    || revoked.status !== 'REVOKED'
  ) {
    throw new Error('NFC integration verification returned an unexpected result');
  }
  return {
    migrationsAndDatabase: 'LIVE',
    provisioned: true,
    activated: true,
    publicStatus: recognized.status,
    consentRedaction: 'VERIFIED',
    replayRejected,
    revokedStatus: revoked.status,
  };
  } catch (error) {
    error.verificationStage = stage;
    throw error;
  }
}

verify()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    const reason = error.code || error.message || error.name;
    process.stderr.write(
      `NFC integration verification failed at ${error.verificationStage || 'unknown'}: ${reason}\n`
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
