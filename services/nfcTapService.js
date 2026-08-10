const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { audit } = require('./clinicalValidation');
const { parseMirroredValue } = require('./nfcNdef');
const {
  uidDigest,
  tokenDigest,
  exchangeToken,
  exchangeOrganizationId,
} = require('./nfcIdentity');
const {
  assertOriginalitySignature,
  assertCardToken,
  digestMatches,
} = require('./nfcValidation');
const {
  scanAttestationPayload,
  verifyDeviceSignature,
} = require('./nfcDeviceAttestation');
const {
  loadNfcClinicalSummary,
  loadNfcImmunizationSummary,
} = require('./nfcClinicalSummaryService');
const { createDeviceService } = require('./deviceService');
const {
  TAGWRITER_DEMO_SCAN_MODE,
  isTagWriterDemoBinding,
} = require('./nfcTagWriter');

const NFC_RESOLVER_ROLES = new Set([
  'OWNER',
  'ADMIN',
  'HEALTH_WORKER',
  'NUTRITION_WORKER',
  'EMERGENCY_COORDINATOR',
]);

const NFC_IMMUNIZATION_ACCESS_ROLES = new Set([
  'OWNER',
  'ADMIN',
  'HEALTH_WORKER',
  'CAREGIVER',
]);

const IMMUNIZATION_ACCESS_INTENT = 'IMMUNIZATION_CERTIFICATES';

function normalizeAccessIntent(value) {
  return value === IMMUNIZATION_ACCESS_INTENT
    ? IMMUNIZATION_ACCESS_INTENT
    : 'CLINICAL_SUMMARY';
}

function createNfcTapService(
  prismaClient,
  { config: configOverride, now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const settings = configOverride || require('../config').nfc;
  const deviceService = createDeviceService(database);

  async function routeFor(publicId) {
    if (!/^[A-Za-z0-9_-]{24}$/.test(publicId)) {
      throw new DomainError(404, 'NFC_CARD_NOT_FOUND', 'NFC card was not found');
    }
    const route = await database.nfcPublicRoute.findUnique({
      where: { publicId },
    });
    if (!route) throw new DomainError(404, 'NFC_CARD_NOT_FOUND', 'NFC card was not found');
    return route;
  }

  async function assertResolverMembership(
    transaction,
    organizationId,
    actorSubjectId,
    accessIntent = 'CLINICAL_SUMMARY',
    childId = null
  ) {
    const membership = await transaction.organizationMembership.findUnique({
      where: {
        organizationId_subjectId: {
          organizationId,
          subjectId: actorSubjectId,
        },
      },
      select: { id: true, status: true, role: true },
    });
    const allowedRoles = accessIntent === IMMUNIZATION_ACCESS_INTENT
      ? NFC_IMMUNIZATION_ACCESS_ROLES
      : NFC_RESOLVER_ROLES;
    if (
      !membership
      || membership.status !== 'ACTIVE'
      || !allowedRoles.has(membership.role)
    ) {
      throw new DomainError(
        403,
        'NFC_ORGANIZATION_ACCESS_DENIED',
        'The authenticated account cannot access this NFC card for the requested purpose'
      );
    }

    if (accessIntent === IMMUNIZATION_ACCESS_INTENT && membership.role === 'CAREGIVER') {
      const link = childId
        ? await transaction.childCaregiver.findFirst({
          where: {
            organizationId,
            childId,
            caregiver: { subjectId: actorSubjectId },
          },
          select: { id: true },
        })
        : null;
      if (!link) {
        throw new DomainError(
          403,
          'CAREGIVER_CHILD_ACCESS_DENIED',
          'This child is not linked to the authenticated caregiver'
        );
      }
    }

    return membership;
  }

  async function createChallenge(context, input) {
    const route = await routeFor(String(input.publicId || ''));
    const accessIntent = normalizeAccessIntent(input.accessIntent);
    const authorization = await withTenantTransaction(
      database,
      route.organizationId,
      async (transaction) => {
        const binding = await transaction.nfcCredentialBinding.findFirst({
          where: {
            id: route.bindingId,
            organizationId: route.organizationId,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            credential: { select: { childId: true } },
          },
        });
        if (!binding) {
          throw new DomainError(410, 'NFC_CARD_INACTIVE', 'NFC card is inactive');
        }
        const membership = await assertResolverMembership(
          transaction,
          route.organizationId,
          context.actorSubjectId,
          accessIntent,
          binding.credential.childId
        );
        return {
          membership,
          bindingId: binding.id,
          childId: binding.credential.childId,
        };
      }
    );

    let deviceId = String(input.deviceId || '').trim();
    if (!deviceId) {
      if (!input.device || typeof input.device !== 'object') {
        throw new DomainError(
          400,
          'VALIDATION_ERROR',
          'deviceId or device registration details are required'
        );
      }
      const registration = await deviceService.register(
        {
          organizationId: route.organizationId,
          actorSubjectId: context.actorSubjectId,
          role: authorization.membership.role,
          membershipId: authorization.membership.id,
          purpose: context.purpose,
        },
        input.device
      );
      deviceId = registration.device.id;
    }

    const challengeToken = exchangeToken(route.organizationId);
    const expiresAt = new Date(now().getTime() + 60 * 1000);
    await withTenantTransaction(database, route.organizationId, async (transaction) => {
      await assertResolverMembership(
        transaction,
        route.organizationId,
        context.actorSubjectId,
        accessIntent,
        authorization.childId
      );
      const [binding, device] = await Promise.all([
        transaction.nfcCredentialBinding.findFirst({
          where: {
            id: authorization.bindingId,
            organizationId: route.organizationId,
            status: 'ACTIVE',
          },
          select: { id: true },
        }),
        transaction.fieldDevice.findFirst({
          where: {
            id: deviceId,
            organizationId: route.organizationId,
            subjectId: context.actorSubjectId,
            status: 'ACTIVE',
          },
          select: { id: true, publicKey: true },
        }),
      ]);
      if (!binding) throw new DomainError(410, 'NFC_CARD_INACTIVE', 'NFC card is inactive');
      if (!device?.publicKey) {
        throw new DomainError(
          403,
          'NFC_SCANNER_NOT_ATTESTED',
          'The worker device must have a registered scanner public key'
        );
      }
      await transaction.nfcScanChallenge.create({
        data: {
          organizationId: route.organizationId,
          bindingId: binding.id,
          actorSubjectId: context.actorSubjectId,
          deviceId,
          tokenHash: tokenDigest(challengeToken),
          expiresAt,
        },
      });
    });
    return {
      challengeToken,
      expiresAt,
      deviceId,
      organizationId: route.organizationId,
      accessIntent,
    };
  }

  async function resolve(context, input) {
    const organizationId = exchangeOrganizationId(input.challengeToken);
    if (!organizationId) {
      throw new DomainError(
        400,
        'INVALID_NFC_CHALLENGE_TOKEN',
        'NFC challenge token is malformed'
      );
    }
    const scanMode = input.scanMode === 'PWA_NDEF'
      ? 'PWA_NDEF'
      : input.scanMode === TAGWRITER_DEMO_SCAN_MODE
        ? TAGWRITER_DEMO_SCAN_MODE
        : 'NATIVE_RAW';
    const accessIntent = normalizeAccessIntent(input.accessIntent);
    const tagWriterDemoScan = scanMode === TAGWRITER_DEMO_SCAN_MODE;
    const mirrored = tagWriterDemoScan ? null : parseMirroredValue(input.uc);
    const cardToken = assertCardToken(input.cardToken);
    const originalitySignature = scanMode === 'NATIVE_RAW'
      ? assertOriginalitySignature(input.originalitySignature)
      : null;
    return withTenantTransaction(database, organizationId, async (transaction) => {
      const challenge = await transaction.nfcScanChallenge.findFirst({
        where: {
          organizationId,
          tokenHash: tokenDigest(input.challengeToken),
          actorSubjectId: context.actorSubjectId,
          status: 'PENDING',
          expiresAt: { gt: now() },
        },
        include: {
          binding: {
            include: {
              credential: {
                include: {
                  child: {
                    select: {
                      id: true,
                      medfinetId: true,
                      firstName: true,
                      lastName: true,
                      dateOfBirth: true,
                      sex: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!challenge) {
        throw new DomainError(
          404,
          'NFC_SCAN_CHALLENGE_NOT_FOUND',
          'NFC scan challenge is invalid, expired, or already used'
        );
      }
      const device = await transaction.fieldDevice.findFirst({
        where: {
          id: challenge.deviceId,
          organizationId,
          subjectId: context.actorSubjectId,
          status: 'ACTIVE',
        },
        select: { id: true, publicKey: true },
      });
      if (!device?.publicKey) {
        throw new DomainError(403, 'NFC_SCANNER_NOT_ATTESTED', 'Scanner is not attested');
      }
      await assertResolverMembership(
        transaction,
        organizationId,
        context.actorSubjectId,
        accessIntent,
        challenge.binding.credential.childId
      );
      verifyDeviceSignature(
        device.publicKey,
        scanAttestationPayload({ ...input, scanMode, originalitySignature }),
        input.deviceSignature
      );
      const binding = challenge.binding;
      const tagWriterDemoBinding = isTagWriterDemoBinding(binding);
      if (
        binding.publicId !== input.publicId
        || binding.status !== 'ACTIVE'
        || binding.credential.status !== 'ACTIVE'
        || (
          binding.credential.expiresAt
          && binding.credential.expiresAt <= now()
        )
        || binding.credential.child.status !== 'ACTIVE'
      ) {
        throw new DomainError(410, 'NFC_CARD_INACTIVE', 'NFC card is inactive');
      }
      if (
        !digestMatches(cardToken, binding.credential.tokenHash)
        || tagWriterDemoScan !== tagWriterDemoBinding
        || (
          !tagWriterDemoScan
          && uidDigest(mirrored.uid, settings.uidPepper) !== binding.uidHash
        )
        || (
          scanMode === 'NATIVE_RAW'
          && !digestMatches(originalitySignature, binding.originalitySignatureHash)
        )
      ) {
        throw new DomainError(
          401,
          'NFC_CARD_ATTESTATION_MISMATCH',
          'Scanned NTAG215 identity does not match the enrolled card'
        );
      }
      if (!tagWriterDemoScan) {
        const claimed = await transaction.nfcCredentialBinding.updateMany({
          where: {
            id: binding.id,
            organizationId,
            status: 'ACTIVE',
            lastCounter: { lt: mirrored.counter },
          },
          data: { lastCounter: mirrored.counter },
        });
        if (claimed.count !== 1) {
          throw new DomainError(
            409,
            'NFC_COUNTER_REPLAYED',
            'This NTAG215 counter was already accepted or moved backwards'
          );
        }
      }
      const consumedAt = now();
      const consumed = await transaction.nfcScanChallenge.updateMany({
        where: { id: challenge.id, status: 'PENDING' },
        data: { status: 'CONSUMED', consumedAt },
      });
      if (consumed.count !== 1) {
        throw new DomainError(409, 'NFC_SCAN_REPLAYED', 'NFC challenge was already used');
      }
      await Promise.all([
        transaction.credentialScan.create({
          data: {
            organizationId,
            credentialId: binding.credentialId,
            actorSubjectId: context.actorSubjectId,
            purpose: context.purpose,
            outcome: scanMode === 'NATIVE_RAW'
              ? 'NTAG215_ATTESTED_RESOLVED'
              : tagWriterDemoScan
                ? 'TAGWRITER_DEMO_NDEF_RESOLVED'
                : 'NTAG215_PWA_NDEF_RESOLVED',
            deviceId: challenge.deviceId,
          },
        }),
        transaction.fieldDevice.update({
          where: { id: challenge.deviceId },
          data: { lastSeenAt: consumedAt },
        }),
        transaction.childCredential.update({
          where: { id: binding.credentialId },
          data: { lastScannedAt: consumedAt },
        }),
        transaction.auditEvent.create({
          data: audit(
            { ...context, organizationId },
            'nfc.resolved',
            'credential',
            binding.credentialId,
            {
              childId: binding.credential.childId,
              deviceId: challenge.deviceId,
              counter: mirrored?.counter ?? null,
              accessIntent,
              assurance: scanMode === 'NATIVE_RAW'
                ? 'DEVICE_ATTESTED_ORIGINALITY_BOUND'
                : tagWriterDemoScan
                  ? 'AUTHENTICATED_STATIC_NDEF_DEMO'
                  : 'AUTHENTICATED_PWA_NDEF',
            }
          ),
        }),
      ]);
      const clinicalSummary = accessIntent === IMMUNIZATION_ACCESS_INTENT
        ? await loadNfcImmunizationSummary(
          transaction,
          organizationId,
          binding.credential.child,
          consumedAt,
          context.purpose,
          context.actorSubjectId
        )
        : await loadNfcClinicalSummary(
          transaction,
          organizationId,
          binding.credential.child,
          consumedAt,
          context.purpose,
          context.actorSubjectId
        );
      const clinicalAllowed = clinicalSummary.clinicalAccess === 'ALLOWED';
      return {
        organizationId,
        accessIntent,
        assurance: scanMode === 'NATIVE_RAW'
          ? 'DEVICE_ATTESTED_ORIGINALITY_BOUND'
          : tagWriterDemoScan
            ? 'AUTHENTICATED_STATIC_NDEF_DEMO'
            : 'AUTHENTICATED_PWA_NDEF',
        limitations: tagWriterDemoScan
          ? [
            'TagWriter demo links can be copied and do not prove possession of the original card',
            'Use the approved raw-NFC provisioning flow before production issuance',
          ]
          : scanMode === 'PWA_NDEF'
            ? ['Browser NFC cannot execute NTAG215 READ_SIG or password commands']
            : [],
        credential: {
          id: binding.credential.id,
          kind: binding.credential.kind,
          status: binding.credential.status,
        },
        child: clinicalAllowed
          ? binding.credential.child
          : { id: binding.credential.child.id, identityRedacted: true },
        clinicalSummary,
        actions: {
          ...(clinicalAllowed ? {
            clinicalRecord: `/children/${binding.credential.childId}/timeline`,
            recordVaccination: `/children/${binding.credential.childId}/immunizations`,
          } : {}),
          emergencyAccess: `/children/${binding.credential.childId}/emergency-access`,
        },
      };
    });
  }

  return { createChallenge, resolve };
}

module.exports = {
  createNfcTapService,
  IMMUNIZATION_ACCESS_INTENT,
};
