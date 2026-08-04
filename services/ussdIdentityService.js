const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const {
  hashPin,
  normalizePhone,
  phoneDigest,
  verifyPin,
} = require('./ussdSecurity');

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

function createUssdIdentityService(
  prismaClient,
  { config: configOverride, now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const settings = configOverride || require('../config').ussd;

  async function setupAccess(context, caregiverId, input) {
    const phone = normalizePhone(input.phone);
    const digest = phoneDigest(phone, settings.phonePepper);
    const pinHash = await hashPin(input.pin, settings.pinPepper);
    const currentTime = now();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const caregiver = await transaction.caregiver.findFirst({
        where: { id: caregiverId, organizationId: context.organizationId },
      });
      if (!caregiver) {
        throw new DomainError(404, 'CAREGIVER_NOT_FOUND', 'Caregiver not found');
      }
      if (caregiver.phoneNormalized && caregiver.phoneNormalized !== phone) {
        const oldDigest = phoneDigest(caregiver.phoneNormalized, settings.phonePepper);
        await transaction.ussdPhoneRoute.updateMany({
          where: {
            phoneDigest: oldDigest,
            organizationId: context.organizationId,
            caregiverId,
            disabledAt: null,
          },
          data: { disabledAt: currentTime },
        });
      }
      const updated = await transaction.caregiver.update({
        where: { id: caregiver.id },
        data: {
          phone,
          phoneNormalized: phone,
          phoneVerifiedAt: currentTime,
          ussdPinHash: pinHash,
          ussdPinFailedAttempts: 0,
          ussdPinLockedUntil: null,
          ussdPinChangedAt: currentTime,
        },
        select: {
          id: true,
          organizationId: true,
          phoneNormalized: true,
          phoneVerifiedAt: true,
          preferredLanguage: true,
        },
      });
      await transaction.ussdPhoneRoute.upsert({
        where: {
          phoneDigest_organizationId_caregiverId: {
            phoneDigest: digest,
            organizationId: context.organizationId,
            caregiverId,
          },
        },
        create: {
          phoneDigest: digest,
          organizationId: context.organizationId,
          caregiverId,
        },
        update: { disabledAt: null },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'ussd.access-configured',
          entityType: 'caregiver',
          entityId: caregiverId,
          purpose: context.purpose,
          metadata: { phoneLastFour: phone.slice(-4) },
        },
      });
      return updated;
    });
  }

  async function resolveRoutes(phone) {
    const normalized = normalizePhone(phone);
    const digest = phoneDigest(normalized, settings.phonePepper);
    const routes = await database.ussdPhoneRoute.findMany({
      where: { phoneDigest: digest, disabledAt: null },
      select: { organizationId: true, caregiverId: true },
      take: 10,
    });
    return { digest, normalized, routes };
  }

  async function verifySessionPin(session, pin) {
    if (!session.organizationId || !session.caregiverId) {
      throw new DomainError(401, 'USSD_ACCOUNT_NOT_SELECTED', 'Select an account before entering a PIN');
    }
    const currentTime = now();
    return withTenantTransaction(database, session.organizationId, async (transaction) => {
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "caregivers" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
        session.caregiverId,
        session.organizationId
      );
      const caregiver = await transaction.caregiver.findFirst({
        where: {
          id: session.caregiverId,
          organizationId: session.organizationId,
          phoneVerifiedAt: { not: null },
        },
      });
      if (!caregiver?.ussdPinHash) {
        throw new DomainError(403, 'USSD_PIN_NOT_CONFIGURED', 'USSD access is not configured');
      }
      if (caregiver.ussdPinLockedUntil && caregiver.ussdPinLockedUntil > currentTime) {
        throw new DomainError(429, 'USSD_PIN_LOCKED', 'USSD PIN is temporarily locked');
      }
      const valid = await verifyPin(pin, caregiver.ussdPinHash, settings.pinPepper);
      if (!valid) {
        const attempts = caregiver.ussdPinFailedAttempts + 1;
        await transaction.caregiver.update({
          where: { id: caregiver.id },
          data: {
            ussdPinFailedAttempts: Math.min(attempts, MAX_PIN_ATTEMPTS),
            ...(attempts >= MAX_PIN_ATTEMPTS
              ? { ussdPinLockedUntil: new Date(currentTime.getTime() + PIN_LOCK_MINUTES * 60_000) }
              : {}),
          },
        });
        throw new DomainError(401, 'USSD_PIN_INCORRECT', 'The PIN is incorrect');
      }
      await transaction.caregiver.update({
        where: { id: caregiver.id },
        data: { ussdPinFailedAttempts: 0, ussdPinLockedUntil: null },
      });
      await transaction.ussdSession.update({
        where: { id: session.id },
        data: { assurance: 'PIN', pinVerifiedAt: currentTime },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: session.organizationId,
          actorSubjectId: `ussd:${session.id}`,
          action: 'ussd.pin-verified',
          entityType: 'caregiver',
          entityId: caregiver.id,
          purpose: 'ussd-account-access',
        },
      });
      return { caregiverId: caregiver.id, assurance: 'PIN' };
    });
  }

  return { resolveRoutes, setupAccess, verifySessionPin };
}

module.exports = { createUssdIdentityService, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES };
