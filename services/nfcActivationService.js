const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { audit } = require('./clinicalValidation');
const { requiredText } = require('./identityService');
const {
  buildNdefManifest,
  materializeNdefUrl,
  parseMirroredValue,
} = require('./nfcNdef');
const { uidDigest, cardAccessCredentials } = require('./nfcIdentity');
const {
  activationAttestationPayload,
  verifyDeviceSignature,
} = require('./nfcDeviceAttestation');
const {
  assertCardToken,
  digestMatches,
  verifyPersonalizationToken,
} = require('./nfcValidation');
const { safeBinding } = require('./nfcBindingView');

function createNfcActivationService(
  prismaClient,
  { config: configOverride, now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const settings = configOverride || require('../config').nfc;

  async function activate(context, bindingId, input) {
    const mirrored = parseMirroredValue(input.uc);
    const cardToken = assertCardToken(input.cardToken);
    const currentTime = now();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const binding = await transaction.nfcCredentialBinding.findFirst({
        where: {
          id: bindingId,
          organizationId: context.organizationId,
          status: 'PENDING',
        },
        include: { credential: true },
      });
      if (!binding) {
        throw new DomainError(
          404,
          'NFC_PENDING_BINDING_NOT_FOUND',
          'Pending NFC provisioning record not found'
        );
      }
      verifyPersonalizationToken(binding, input.personalizationToken, currentTime);
      if (!binding.preparedAt || !binding.uidHash) {
        throw new DomainError(
          409,
          'NFC_CARD_NOT_PREPARED',
          'Prepare and protect the physical card before activation'
        );
      }
      if (!digestMatches(cardToken, binding.credential.tokenHash)) {
        throw new DomainError(
          401,
          'NFC_CARD_TOKEN_INVALID',
          'The NDEF card token does not match the issued credential'
        );
      }
      if (uidDigest(mirrored.uid, settings.uidPepper) !== binding.uidHash) {
        throw new DomainError(
          409,
          'NFC_CARD_IDENTITY_MISMATCH',
          'The read-back UID does not match the prepared physical card'
        );
      }
      if (input.writeProtected !== true || input.configurationLocked !== true) {
        throw new DomainError(
          400,
          'NFC_PROTECTION_NOT_VERIFIED',
          'Write protection and configuration lock must be verified before activation'
        );
      }
      if (settings.requireOriginalityAttestation && !binding.originalityVerifiedAt) {
        throw new DomainError(
          409,
          'NFC_ORIGINALITY_NOT_VERIFIED',
          'NXP originality must be verified before activation'
        );
      }
      assertProtectedReadback(binding, input, cardToken, mirrored.uid, settings);
      const deviceId = requiredText(input.deviceId, 'deviceId', 120);
      const device = await transaction.fieldDevice.findFirst({
        where: {
          id: deviceId,
          organizationId: context.organizationId,
          subjectId: context.actorSubjectId,
          status: 'ACTIVE',
          nfcProvisioningEnabled: true,
        },
        select: { id: true, publicKey: true },
      });
      if (!device?.publicKey) {
        throw new DomainError(
          403,
          'NFC_PROVISIONING_STATION_NOT_ATTESTED',
          'Activation requires an administrator-approved raw-NFC station with a device key'
        );
      }
      verifyDeviceSignature(
        device.publicKey,
        activationAttestationPayload(binding.id, input),
        input.deviceSignature
      );
      const activated = await transaction.nfcCredentialBinding.update({
        where: { id: binding.id },
        data: {
          status: 'ACTIVE',
          lastCounter: mirrored.counter,
          writeProtectedAt: currentTime,
          configurationLockedAt: currentTime,
          activatedAt: currentTime,
          activatedBySubjectId: context.actorSubjectId,
        },
      });
      await Promise.all([
        transaction.auditEvent.create({
          data: audit(context, 'nfc.activated', 'nfc-binding', binding.id, {
            credentialId: binding.credentialId,
            childId: binding.credential.childId,
            initialCounter: mirrored.counter,
            originalityVerified: Boolean(binding.originalityVerifiedAt),
            deviceId,
          }),
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
            aggregateType: 'blockchain-anchor',
            aggregateId: binding.id,
            idempotencyKey: `blockchain:6:${binding.id}`,
            payload: {
              eventCode: 0x06,
              anchorId: `nfc-activate:${binding.id}`,
              tenantId: context.organizationId,
            },
          },
        }),
      ]);
      return safeBinding(activated);
    });
  }

  return { activate };
}

function assertProtectedReadback(binding, input, cardToken, uid, settings) {
  const access = cardAccessCredentials(uid, binding.publicId, settings.provisioningSecret);
  const manifest = buildNdefManifest(settings.tapBaseUrl, binding.publicId, cardToken);
  const expectedNdef = materializeNdefUrl(manifest.ndefUrlTemplate, input.uc);
  if (
    input.ndefReadback !== expectedNdef
    || String(input.configurationPageHex || '').toUpperCase()
      !== manifest.stationPlan.configurationPageHex
    || String(input.accessPageHex || '').toUpperCase()
      !== manifest.stationPlan.accessPageFinalHex
    || String(input.packResponseHex || '').toUpperCase() !== access.packHex
  ) {
    throw new DomainError(
      409,
      'NFC_PROTECTED_READBACK_MISMATCH',
      'Protected NDEF, configuration, access, or PACK read-back does not match the issued NTAG215'
    );
  }
}

module.exports = { createNfcActivationService, assertProtectedReadback };
