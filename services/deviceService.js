const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const DEVICE_STATUSES = new Set(['REVOKED', 'LOST']);
const ADMINISTRATION_ROLES = new Set(['OWNER', 'ADMIN']);

function deviceIdentifierDigest(identifier, pepper) {
  return crypto
    .createHmac('sha256', pepper)
    .update(requiredText(identifier, 'deviceIdentifier', 500), 'utf8')
    .digest('hex');
}

function normalizeDevicePublicKey(value) {
  if (!value) return null;
  const supplied = requiredText(value, 'publicKey', 2000);
  let key;
  try {
    key = crypto.createPublicKey(supplied);
  } catch {
    throw new DomainError(
      400,
      'INVALID_DEVICE_PUBLIC_KEY',
      'publicKey must be a valid Ed25519 public key'
    );
  }
  const supported = key.asymmetricKeyType === 'ed25519'
    || (
      key.asymmetricKeyType === 'ec'
      && key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
    );
  if (!supported) {
    throw new DomainError(
      400,
      'UNSUPPORTED_DEVICE_PUBLIC_KEY',
      'Only Ed25519 or hardware-backed P-256 device keys are supported'
    );
  }
  return key.export({ type: 'spki', format: 'pem' }).toString();
}

function createDeviceService(prismaClient, { pepper } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const activePepper = pepper || require('../config').security.deviceIdentifierPepper;

  async function register(context, input) {
    const digest = deviceIdentifierDigest(input.deviceIdentifier, activePepper);
    const publicKey = normalizeDevicePublicKey(input.publicKey);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.fieldDevice.findUnique({
        where: {
          organizationId_deviceIdentifierHash: {
            organizationId: context.organizationId,
            deviceIdentifierHash: digest,
          },
        },
      });
      if (existing) {
        if (existing.subjectId !== context.actorSubjectId) {
          throw new DomainError(
            409,
            'DEVICE_ALREADY_REGISTERED',
            'This device is registered to another subject'
          );
        }
        if (existing.status !== 'ACTIVE') {
          throw new DomainError(
            409,
            'DEVICE_NOT_ACTIVE',
            'A revoked or lost device cannot be reactivated'
          );
        }
        if (
          existing.publicKey
          && publicKey
          && existing.publicKey !== publicKey
        ) {
          throw new DomainError(
            409,
            'DEVICE_KEY_ROTATION_REQUIRES_REVOCATION',
            'Revoke this device before registering a different device key'
          );
        }
        const device = await transaction.fieldDevice.update({
          where: { id: existing.id },
          data: {
            displayName: requiredText(input.displayName, 'displayName', 120),
            platform: requiredText(input.platform, 'platform', 80),
            appVersion: requiredText(input.appVersion, 'appVersion', 40),
            ...(publicKey ? { publicKey } : {}),
            lastSeenAt: new Date(),
          },
        });
        return { device, existing: true };
      }
      const device = await transaction.fieldDevice.create({
        data: {
          organizationId: context.organizationId,
          subjectId: context.actorSubjectId,
          deviceIdentifierHash: digest,
          displayName: requiredText(input.displayName, 'displayName', 120),
          platform: requiredText(input.platform, 'platform', 80),
          appVersion: requiredText(input.appVersion, 'appVersion', 40),
          ...(publicKey ? { publicKey } : {}),
          lastSeenAt: new Date(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'device.registered',
          entityType: 'field-device',
          entityId: device.id,
          purpose: context.purpose,
          metadata: {
            platform: device.platform,
            appVersion: device.appVersion,
          },
        },
      });
      return { device, existing: false };
    });
  }

  async function revoke(context, deviceId, input) {
    if (!DEVICE_STATUSES.has(input.status)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'status must be REVOKED or LOST');
    }
    const reason = requiredText(input.reason, 'reason', 500);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.fieldDevice.findFirst({
        where: { id: deviceId, organizationId: context.organizationId },
      });
      if (!existing) throw new DomainError(404, 'DEVICE_NOT_FOUND', 'Device not found');
      const ownsDevice = existing.subjectId === context.actorSubjectId;
      if (!ownsDevice && !ADMINISTRATION_ROLES.has(context.role)) {
        throw new DomainError(403, 'DEVICE_REVOCATION_DENIED', 'Device revocation is not permitted');
      }
      if (existing.status !== 'ACTIVE') {
        throw new DomainError(409, 'DEVICE_NOT_ACTIVE', 'Device is already revoked or lost');
      }
      const device = await transaction.fieldDevice.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          revokedAt: new Date(),
          revokedBySubjectId: context.actorSubjectId,
          revocationReason: reason,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: input.status === 'LOST' ? 'device.reported-lost' : 'device.revoked',
          entityType: 'field-device',
          entityId: device.id,
          purpose: context.purpose,
          metadata: {
            deviceSubjectId: existing.subjectId,
            reason,
          },
        },
      });
      return device;
    });
  }

  async function setNfcProvisioningCapability(context, deviceId, enabled) {
    if (!ADMINISTRATION_ROLES.has(context.role)) {
      throw new DomainError(
        403,
        'NFC_STATION_APPROVAL_DENIED',
        'Only an owner or administrator can approve NFC provisioning stations'
      );
    }
    if (typeof enabled !== 'boolean') {
      throw new DomainError(400, 'VALIDATION_ERROR', 'enabled must be boolean');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.fieldDevice.findFirst({
        where: {
          id: deviceId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      if (!existing) throw new DomainError(404, 'DEVICE_NOT_FOUND', 'Active device not found');
      if (enabled && !existing.publicKey) {
        throw new DomainError(
          409,
          'NFC_STATION_KEY_REQUIRED',
          'Register a device public key before approving NFC provisioning'
        );
      }
      const device = await transaction.fieldDevice.update({
        where: { id: existing.id },
        data: enabled
          ? {
            nfcProvisioningEnabled: true,
            nfcProvisioningApprovedAt: new Date(),
            nfcProvisioningApprovedBySubjectId: context.actorSubjectId,
          }
          : {
            nfcProvisioningEnabled: false,
            nfcProvisioningApprovedAt: null,
            nfcProvisioningApprovedBySubjectId: null,
          },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: enabled ? 'device.nfc-provisioning-approved' : 'device.nfc-provisioning-disabled',
          entityType: 'field-device',
          entityId: device.id,
          purpose: context.purpose,
          metadata: { enabled },
        },
      });
      return device;
    });
  }

  return { register, revoke, setNfcProvisioningCapability };
}

module.exports = {
  createDeviceService,
  deviceIdentifierDigest,
  normalizeDevicePublicKey,
};
