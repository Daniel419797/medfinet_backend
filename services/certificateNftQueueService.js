const { DomainError } = require('../utils/domainError');
const { EVENT_TYPES } = require('./blockchain/eventTypes');
const { certificateNftOutboxData } = require('./certificateNftService');
const { IMMUNIZATION_FINGERPRINT_VERSION } = require('./immunizationIntegrity');
const { withTenantTransaction } = require('./tenantContext');

const PROOF_PATTERN = /^(immunization-recorded|immunization-amended):v(\d+):([^:]+):([0-9a-f]{64})$/;

function proofPartsFromProofId(proofId) {
  const match = PROOF_PATTERN.exec(String(proofId || ''));
  if (!match) {
    throw new DomainError(
      400,
      'CERTIFICATE_NFT_PROOF_INVALID',
      'Immunization proof does not contain a valid versioned fingerprint',
    );
  }
  const fingerprintVersion = Number(match[2]);
  if (
    !Number.isInteger(fingerprintVersion)
    || fingerprintVersion !== IMMUNIZATION_FINGERPRINT_VERSION
  ) {
    throw new DomainError(
      409,
      'CERTIFICATE_NFT_PROOF_VERSION_UNSUPPORTED',
      'Immunization proof uses an unsupported fingerprint version',
    );
  }
  return {
    kind: match[1],
    aggregateId: match[3],
    fingerprintVersion,
    fingerprint: match[4],
  };
}

function fingerprintFromProofId(proofId) {
  return proofPartsFromProofId(proofId).fingerprint;
}

function createCertificateNftQueueService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function queueFromAnchorEvent(context, event) {
    const eventCode = Number(event?.payload?.eventCode);
    if (![EVENT_TYPES.IMMUNIZATION_RECORD.code, EVENT_TYPES.IMMUNIZATION_AMEND.code].includes(eventCode)) {
      return { queued: false, reason: 'NOT_IMMUNIZATION_ANCHOR' };
    }
    const tenantId = String(event?.payload?.tenantId || '');
    const proofId = String(event?.payload?.anchorId || '');
    if (!tenantId || tenantId !== context.organizationId || !proofId) {
      throw new DomainError(
        400,
        'CERTIFICATE_NFT_PROOF_INVALID',
        'Immunization anchor is not bound to the active organization',
      );
    }
    const proof = proofPartsFromProofId(proofId);
    const expectedKind = eventCode === EVENT_TYPES.IMMUNIZATION_RECORD.code
      ? 'immunization-recorded'
      : 'immunization-amended';
    if (proof.kind !== expectedKind || proof.aggregateId !== event.aggregateId) {
      throw new DomainError(
        409,
        'CERTIFICATE_NFT_PROOF_MISMATCH',
        'Immunization anchor identity does not match its proof ID',
      );
    }

    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      let immunizationId;
      if (eventCode === EVENT_TYPES.IMMUNIZATION_RECORD.code) {
        immunizationId = event.aggregateId;
        const record = await transaction.immunizationRecord.findFirst({
          where: {
            id: immunizationId,
            organizationId: context.organizationId,
          },
          select: { id: true },
        });
        if (!record) {
          throw new DomainError(
            404,
            'IMMUNIZATION_NOT_FOUND',
            'Anchored immunization record was not found for NFT minting',
          );
        }
      } else {
        const amendment = await transaction.clinicalAmendment.findFirst({
          where: {
            id: event.aggregateId,
            organizationId: context.organizationId,
            immunizationId: { not: null },
          },
          select: { immunizationId: true },
        });
        if (!amendment?.immunizationId) {
          throw new DomainError(
            404,
            'IMMUNIZATION_AMENDMENT_NOT_FOUND',
            'Anchored immunization amendment was not found for NFT minting',
          );
        }
        immunizationId = amendment.immunizationId;
      }

      const request = certificateNftOutboxData(
        {
          id: immunizationId,
          organizationId: context.organizationId,
        },
        {
          aggregateId: event.aggregateId,
          anchorId: proofId,
          fingerprint: proof.fingerprint,
          fingerprintVersion: proof.fingerprintVersion,
        },
      );
      const existing = await transaction.outboxEvent.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: context.organizationId,
            idempotencyKey: request.idempotencyKey,
          },
        },
      });
      if (existing) {
        return {
          queued: false,
          eventId: existing.id,
          status: existing.status,
          immunizationId,
          proofId,
        };
      }
      const created = await transaction.outboxEvent.create({ data: request });
      return {
        queued: true,
        eventId: created.id,
        status: created.status,
        immunizationId,
        proofId,
      };
    });
  }

  return { queueFromAnchorEvent };
}

module.exports = {
  createCertificateNftQueueService,
  fingerprintFromProofId,
  proofPartsFromProofId,
};
