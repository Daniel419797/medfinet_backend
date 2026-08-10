const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { parseMirroredValue } = require('./nfcNdef');
const { uidDigest, tokenDigest } = require('./nfcIdentity');
const { assertCardToken } = require('./nfcValidation');
const {
  isTagWriterDemoBinding,
} = require('./nfcTagWriter');

function createNfcPublicTapService(
  prismaClient,
  { config: configOverride, now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const settings = configOverride || require('../config').nfc;

  async function verifyPublicTap(publicId, input) {
    if (!/^[A-Za-z0-9_-]{24}$/.test(publicId)) {
      throw new DomainError(404, 'NFC_CARD_NOT_FOUND', 'NFC card was not found');
    }
    const route = await database.nfcPublicRoute.findUnique({ where: { publicId } });
    if (!route) {
      throw new DomainError(404, 'NFC_CARD_NOT_FOUND', 'NFC card was not found');
    }
    const cardTokenHash = tokenDigest(assertCardToken(input.t));
    const binding = await withTenantTransaction(
      database,
      route.organizationId,
      (transaction) => transaction.nfcCredentialBinding.findFirst({
        where: {
          id: route.bindingId,
          organizationId: route.organizationId,
          publicId,
          credential: { tokenHash: cardTokenHash },
        },
        select: {
          id: true,
          status: true,
          hardwareFamily: true,
          uidHash: true,
          originalityVerifiedAt: true,
          credential: { select: { status: true, expiresAt: true } },
        },
      })
    );
    if (!binding) {
      throw new DomainError(410, 'NFC_CARD_INACTIVE', 'NFC card is invalid or inactive');
    }
    if (!isTagWriterDemoBinding(binding)) {
      const mirrored = parseMirroredValue(input.uc);
      if (uidDigest(mirrored.uid, settings.uidPepper) !== binding.uidHash) {
        throw new DomainError(410, 'NFC_CARD_INACTIVE', 'NFC card is invalid or inactive');
      }
    }
    return publicStatus(binding, now());
  }

  return { verifyPublicTap };
}

function publicStatus(binding, currentTime) {
  let status = 'ACTIVE';
  let message = 'Card recognized. Sign in to view permitted vaccination records and certificates.';
  if (binding.credential.status === 'ROTATED') {
    status = 'REPLACED';
    message = 'This card has been replaced. Present the replacement card at a Medfinet facility.';
  } else if (binding.status === 'REVOKED' || binding.credential.status === 'REVOKED') {
    status = 'REVOKED';
    message = 'This card has been revoked. Contact a Medfinet facility for assistance.';
  } else if (binding.status === 'SUSPENDED' || binding.credential.status === 'SUSPENDED') {
    status = 'SUSPENDED';
    message = 'This card is temporarily suspended. Contact a Medfinet facility for assistance.';
  } else if (binding.credential.expiresAt && binding.credential.expiresAt <= currentTime) {
    status = 'EXPIRED';
    message = 'This card has expired. Contact a Medfinet facility to renew it.';
  } else if (binding.status !== 'ACTIVE') {
    throw new DomainError(410, 'NFC_CARD_INACTIVE', 'NFC card is invalid or inactive');
  }
  return {
    recognized: true,
    status,
    hardwareFamily: binding.hardwareFamily || 'NTAG_215',
    assurance: isTagWriterDemoBinding(binding)
      ? 'BASIC_STATIC_NDEF_DEMO'
      : 'BASIC_NDEF',
    originalityEnrolled: Boolean(binding.originalityVerifiedAt),
    scannerRequired: status === 'ACTIVE',
    message,
  };
}

module.exports = { createNfcPublicTapService, publicStatus };
