const crypto = require('node:crypto');
const { buildNdefManifest } = require('./nfcNdef');
const { randomToken, tokenDigest } = require('./nfcIdentity');

function createDraftMaterial(settings, currentTime) {
  const personalizationToken = randomToken();
  const cardToken = randomToken();
  const publicId = crypto.randomBytes(18).toString('base64url');
  return {
    personalizationToken,
    cardToken,
    publicId,
    provisioningExpiresAt: new Date(currentTime.getTime() + 15 * 60 * 1000),
    manifest: buildNdefManifest(settings.tapBaseUrl, publicId, cardToken),
  };
}

async function persistNfcDraft({
  transaction,
  context,
  childId,
  material,
  expiresAt,
  replacesCredentialId,
  hardwareFamily = 'NTAG_215',
  bindingStatus = 'PENDING',
  activatedAt,
  activatedBySubjectId,
}) {
  const credential = await transaction.childCredential.create({
    data: {
      organizationId: context.organizationId,
      childId,
      tokenHash: tokenDigest(material.cardToken),
      kind: 'NFC',
      issuedBySubjectId: context.actorSubjectId,
      ...(expiresAt ? { expiresAt } : {}),
      ...(replacesCredentialId ? { replacesCredentialId } : {}),
    },
  });
  const binding = await transaction.nfcCredentialBinding.create({
    data: {
      organizationId: context.organizationId,
      credentialId: credential.id,
      publicId: material.publicId,
      hardwareFamily,
      status: bindingStatus,
      personalizationNonceHash: tokenDigest(material.personalizationToken),
      provisioningExpiresAt: material.provisioningExpiresAt,
      ...(activatedAt ? { activatedAt } : {}),
      ...(activatedBySubjectId ? { activatedBySubjectId } : {}),
    },
  });
  await transaction.nfcPublicRoute.create({
    data: {
      publicId: material.publicId,
      organizationId: context.organizationId,
      bindingId: binding.id,
    },
  });
  return { credential, binding };
}

module.exports = { createDraftMaterial, persistNfcDraft };
