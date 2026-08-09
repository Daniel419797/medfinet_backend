const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { audit, timestamp } = require('./clinicalValidation');
const { requiredText } = require('./identityService');
const {
  uidDigest,
  tokenDigest,
  cardAccessCredentials,
} = require('./nfcIdentity');
const {
  createDraftMaterial,
  persistNfcDraft,
} = require('./nfcDraftFactory');
const {
  provisioningAttestationPayload,
  verifyDeviceSignature,
} = require('./nfcDeviceAttestation');
const {
  assertUid,
  assertOriginalitySignature,
  assertNtag215Version,
  verifyPersonalizationToken,
} = require('./nfcValidation');
const { safeBinding } = require('./nfcBindingView');
const {
  TAGWRITER_DEMO_HARDWARE_FAMILY,
  buildTagWriterDemoUrl,
} = require('./nfcTagWriter');

function createNfcProvisioningService(
  prismaClient,
  { config: configOverride, now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const settings = configOverride || require('../config').nfc;

  async function createDraft(context, childId, input = {}) {
    const createdAt = now();
    const material = createDraftMaterial(settings, createdAt);
    const expiresAt = input.expiresAt
      ? timestamp(input.expiresAt, 'expiresAt')
      : null;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await transaction.child.findFirst({
        where: {
          id: childId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
      const { credential, binding } = await persistNfcDraft({
        transaction,
        context,
        childId,
        material,
        expiresAt,
      });
      await transaction.auditEvent.create({
        data: audit(context, 'nfc.provisioning-started', 'nfc-binding', binding.id, {
          childId,
          credentialId: credential.id,
          hardwareFamily: 'NTAG_215',
        }),
      });
      return {
        credential: {
          id: credential.id,
          childId: credential.childId,
          kind: credential.kind,
          status: credential.status,
          createdAt: credential.createdAt,
        },
        binding: safeBinding(binding),
        personalizationToken: material.personalizationToken,
        cardToken: material.cardToken,
        manifest: material.manifest,
      };
    });
  }

  async function createTagWriterDemo(context, childId, input = {}) {
    const createdAt = now();
    const material = createDraftMaterial(settings, createdAt);
    const expiresAt = input.expiresAt
      ? timestamp(input.expiresAt, 'expiresAt')
      : null;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await transaction.child.findFirst({
        where: {
          id: childId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');

      const { credential, binding } = await persistNfcDraft({
        transaction,
        context,
        childId,
        material,
        expiresAt,
        hardwareFamily: TAGWRITER_DEMO_HARDWARE_FAMILY,
        bindingStatus: 'ACTIVE',
        activatedAt: createdAt,
        activatedBySubjectId: context.actorSubjectId,
      });
      await transaction.auditEvent.create({
        data: audit(
          context,
          'nfc.tagwriter-demo-activated',
          'nfc-binding',
          binding.id,
          {
            childId,
            credentialId: credential.id,
            assurance: 'AUTHENTICATED_STATIC_NDEF_DEMO',
            limitation: 'Static NDEF links can be copied and do not prove possession of the original card',
          }
        ),
      });

      return {
        credential: {
          id: credential.id,
          childId: credential.childId,
          kind: credential.kind,
          status: credential.status,
          createdAt: credential.createdAt,
        },
        binding: safeBinding(binding),
        tagWriterUrl: buildTagWriterDemoUrl(
          settings.tapBaseUrl,
          material.publicId,
          material.cardToken
        ),
        assurance: 'AUTHENTICATED_STATIC_NDEF_DEMO',
        limitations: [
          'For demonstrations only; the static NDEF link can be copied',
          'Child and clinical data remain server-side and require an authorized Medfinet login',
        ],
      };
    });
  }

  async function prepare(context, bindingId, input) {
    const versionResponse = assertNtag215Version(input.versionResponse);
    const uid = assertUid(input.uid);
    const originalitySignature = assertOriginalitySignature(
      input.originalitySignature
    );
    const currentTime = now();
    const result = await withTenantTransaction(
      database,
      context.organizationId,
      async (transaction) => {
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
        verifyPersonalizationToken(
          binding,
          input.personalizationToken,
          currentTime
        );
        const deviceId = requiredText(input.deviceId, 'deviceId', 120);
        const device = await transaction.fieldDevice.findFirst({
          where: {
            id: deviceId,
            organizationId: context.organizationId,
            subjectId: context.actorSubjectId,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            publicKey: true,
            nfcProvisioningEnabled: true,
          },
        });
        if (!device?.publicKey || !device.nfcProvisioningEnabled) {
          throw new DomainError(
            403,
            'NFC_PROVISIONING_STATION_NOT_ATTESTED',
            'Provisioning requires an administrator-approved raw-NFC station with a device key'
          );
        }
        if (settings.requireOriginalityAttestation && input.originalityVerified !== true) {
          throw new DomainError(
            400,
            'NFC_ORIGINALITY_ATTESTATION_REQUIRED',
            'The provisioning scanner must verify the NXP originality signature'
          );
        }
        verifyDeviceSignature(
          device.publicKey,
          provisioningAttestationPayload(binding.id, {
            ...input,
            versionResponse,
            uid,
            originalitySignature,
          }),
          input.deviceSignature
        );
        const bindingUidHash = uidDigest(uid, settings.uidPepper);
        const duplicate = await transaction.nfcCredentialBinding.findFirst({
          where: {
            organizationId: context.organizationId,
            uidHash: bindingUidHash,
            id: { not: binding.id },
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new DomainError(
            409,
            'NFC_CARD_ALREADY_BOUND',
            'This physical NFC card is already bound in the organization'
          );
        }
        const prepared = await transaction.nfcCredentialBinding.update({
          where: { id: binding.id },
          data: {
            uidHash: bindingUidHash,
            originalitySignatureHash: tokenDigest(originalitySignature),
            ...(input.originalityVerified === true
              ? { originalityVerifiedAt: currentTime }
              : {}),
            preparedAt: currentTime,
            preparedBySubjectId: context.actorSubjectId,
          },
        });
        await transaction.auditEvent.create({
          data: audit(context, 'nfc.prepared', 'nfc-binding', binding.id, {
            credentialId: binding.credentialId,
            childId: binding.credential.childId,
            originalityVerified: input.originalityVerified === true,
            versionResponse,
            deviceId,
          }),
        });
        return { binding, prepared };
      }
    );
    return {
      binding: safeBinding(result.prepared),
      access: cardAccessCredentials(
        uid,
        result.binding.publicId,
        settings.provisioningSecret
      ),
      protection: {
        protectWritesFromPage: 4,
        protectReads: false,
        enableCounter: true,
        protectCounterReads: false,
        authenticationAttemptLimit: 7,
        lockConfiguration: true,
        permanentlyLockUserMemory: false,
      },
    };
  }

  async function revoke(context, bindingId, input) {
    const reason = requiredText(input.reason, 'reason', 500);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const binding = await transaction.nfcCredentialBinding.findFirst({
        where: {
          id: bindingId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        include: { credential: true },
      });
      if (!binding) {
        throw new DomainError(
          404,
          'ACTIVE_NFC_BINDING_NOT_FOUND',
          'Active NFC binding not found'
        );
      }
      const revokedAt = now();
      const revoked = await transaction.nfcCredentialBinding.update({
        where: { id: binding.id },
        data: { status: 'REVOKED' },
      });
      await Promise.all([
        transaction.childCredential.update({
          where: { id: binding.credentialId },
          data: {
            status: 'REVOKED',
            revokedAt,
            revokedReason: reason,
          },
        }),
        transaction.auditEvent.create({
          data: audit(context, 'nfc.revoked', 'nfc-binding', binding.id, {
            credentialId: binding.credentialId,
            childId: binding.credential.childId,
            reason,
          }),
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
            aggregateType: 'blockchain-anchor',
            aggregateId: binding.id,
            idempotencyKey: `blockchain:7:${binding.id}`,
            payload: {
              eventCode: 0x07,
              anchorId: `nfc-revoke:${binding.id}`,
              tenantId: context.organizationId,
            },
          },
        }),
      ]);
      return safeBinding(revoked);
    });
  }

  async function replace(context, bindingId, input) {
    const reason = requiredText(input.reason, 'reason', 500);
    const material = createDraftMaterial(settings, now());
    const expiresAt = input.expiresAt
      ? timestamp(input.expiresAt, 'expiresAt')
      : null;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const oldBinding = await transaction.nfcCredentialBinding.findFirst({
        where: {
          id: bindingId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        include: { credential: true },
      });
      if (!oldBinding) {
        throw new DomainError(
          404,
          'ACTIVE_NFC_BINDING_NOT_FOUND',
          'Active NFC binding not found'
        );
      }
      await Promise.all([
        transaction.nfcCredentialBinding.update({
          where: { id: oldBinding.id },
          data: { status: 'REVOKED' },
        }),
        transaction.childCredential.update({
          where: { id: oldBinding.credentialId },
          data: {
            status: 'ROTATED',
            revokedAt: now(),
            revokedReason: reason,
          },
        }),
      ]);
      const { credential, binding } = await persistNfcDraft({
        transaction,
        context,
        childId: oldBinding.credential.childId,
        material,
        expiresAt,
        replacesCredentialId: oldBinding.credentialId,
      });
      await Promise.all([
        transaction.auditEvent.create({
          data: audit(context, 'nfc.replacement-started', 'nfc-binding', binding.id, {
            childId: credential.childId,
            replacedBindingId: oldBinding.id,
            replacedCredentialId: oldBinding.credentialId,
            reason,
          }),
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
            aggregateType: 'blockchain-anchor',
            aggregateId: binding.id,
            idempotencyKey: `blockchain:8:${oldBinding.id}`,
            payload: {
              eventCode: 0x08,
              anchorId: `nfc-replace:${oldBinding.id}`,
              tenantId: context.organizationId,
            },
          },
        }),
      ]);
      return {
        credential: {
          id: credential.id,
          childId: credential.childId,
          kind: credential.kind,
          status: credential.status,
          replacesCredentialId: credential.replacesCredentialId,
        },
        binding: safeBinding(binding),
        personalizationToken: material.personalizationToken,
        cardToken: material.cardToken,
        manifest: material.manifest,
      };
    });
  }

  return { createDraft, createTagWriterDemo, prepare, revoke, replace };
}

module.exports = {
  createNfcProvisioningService,
  safeBinding,
};
