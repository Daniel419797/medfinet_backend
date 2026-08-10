const { renderCertificate } = require('../controllers/certificate/certificate');
const { DomainError } = require('../utils/domainError');
const { logger } = require('../utils/logger');
const AnchorReceipt = require('./blockchain/AnchorReceipt');
const { EVENT_TYPES } = require('./blockchain/eventTypes');
const { inspectAnchorReceipt } = require('./blockchain/receiptVerification');
const { audit } = require('./clinicalValidation');
const {
  IMMUNIZATION_FINGERPRINT_VERSION,
  amendedImmunizationAnchorId,
  recordedImmunizationAnchorId,
} = require('./immunizationIntegrity');
const { assertResourceScope } = require('./resourceScopeService');
const { withTenantTransaction } = require('./tenantContext');

function safeFilenamePart(value) {
  return String(value || 'record')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'record';
}

function proofMaterial(record) {
  const amendment = record.status === 'AMENDED' ? record.amendments?.[0] : null;
  const event = amendment
    ? EVENT_TYPES.IMMUNIZATION_AMEND
    : EVENT_TYPES.IMMUNIZATION_RECORD;
  const anchorId = amendment
    ? amendedImmunizationAnchorId({
        amendmentId: amendment.id,
        recordId: record.id,
        previous: amendment.previousData,
        replacement: amendment.replacementData,
        reason: amendment.reason,
      })
    : recordedImmunizationAnchorId(record);
  return {
    anchorId,
    aggregateId: amendment?.id || record.id,
    eventCode: event.code,
    fingerprintVersion: IMMUNIZATION_FINGERPRINT_VERSION,
    fingerprint: anchorId.slice(anchorId.lastIndexOf(':') + 1),
  };
}

function certificateFingerprint(record) {
  return proofMaterial(record).fingerprint;
}

function anchorOutboxData(record, proof = proofMaterial(record)) {
  return {
    organizationId: record.organizationId,
    eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
    aggregateType: 'blockchain-anchor',
    aggregateId: proof.aggregateId,
    idempotencyKey: `blockchain:${proof.eventCode}:v${proof.fingerprintVersion}:${proof.aggregateId}`,
    payload: {
      eventCode: proof.eventCode,
      anchorId: proof.anchorId,
      tenantId: record.organizationId,
    },
  };
}

function networkLabel(settings) {
  if (settings.networkName) return settings.networkName;
  let hostname;
  try {
    hostname = new URL(settings.algodServer).hostname.toLowerCase();
  } catch {
    return 'Algorand';
  }
  if (hostname.includes('testnet')) return 'Algorand TestNet';
  if (hostname.includes('mainnet')) return 'Algorand MainNet';
  return 'Algorand';
}

async function defaultInspectReceipt(receipt, settings, expected) {
  const AlgorandAdapter = require('./blockchain/adapters/AlgorandAdapter');
  return inspectAnchorReceipt(
    AnchorReceipt.fromDatabase(receipt),
    new AlgorandAdapter(settings),
    expected,
  );
}

async function queueMissingEvidence(transaction, record, proof) {
  const outboxData = anchorOutboxData(record, proof);
  const where = {
    organizationId_idempotencyKey: {
      organizationId: record.organizationId,
      idempotencyKey: outboxData.idempotencyKey,
    },
  };
  const existing = await transaction.outboxEvent.findUnique({ where });
  if (!existing) {
    await transaction.outboxEvent.upsert({ where, create: outboxData, update: {} });
    return true;
  }
  if (!['FAILED', 'PUBLISHED'].includes(existing.status)) return false;

  const recovered = await transaction.outboxEvent.updateMany({
    where: {
      id: existing.id,
      organizationId: record.organizationId,
      status: existing.status,
      attempts: existing.attempts,
    },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      publishedAt: null,
      lastError: null,
    },
  });
  return recovered.count === 1;
}

function createCertificateService(
  prismaClient,
  renderer = renderCertificate,
  options = {},
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function findRecord(transaction, context, childId, immunizationId) {
    const record = await transaction.immunizationRecord.findFirst({
      where: {
        id: immunizationId,
        childId,
        organizationId: context.organizationId,
        status: { in: ['ACTIVE', 'AMENDED'] },
        child: { status: 'ACTIVE' },
      },
      include: {
        child: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            sex: true,
            medfinetId: true,
          },
        },
        facility: {
          select: {
            name: true,
            administrativeArea: true,
          },
        },
        amendments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            reason: true,
            previousData: true,
            replacementData: true,
          },
        },
      },
    });

    if (!record) {
      throw new DomainError(
        404,
        'IMMUNIZATION_CERTIFICATE_NOT_FOUND',
        'Immunization record not found',
      );
    }

    await assertResourceScope(transaction, context, {
      facilityId: record.facilityId,
      programmeId: record.programmeId,
    });
    return record;
  }

  async function create(context, childId, immunizationId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const record = await findRecord(
        transaction,
        context,
        childId,
        immunizationId,
      );

      const proof = proofMaterial(record);
      const verificationValue = JSON.stringify({
        type: 'MEDFINET_VACCINATION_CERTIFICATE',
        version: 3,
        recordId: record.id,
        fingerprint: proof.fingerprint,
        fingerprintVersion: proof.fingerprintVersion,
        algorandAnchorId: proof.anchorId,
      });
      const buffer = await renderer({
        childName: `${record.child.firstName} ${record.child.lastName}`,
        childDOB: record.child.dateOfBirth,
        sex: record.child.sex,
        state: record.facility?.administrativeArea || '',
        location: record.facility?.name || '',
        vaccineCode: record.vaccineCode,
        doseNumber: record.doseNumber,
        verificationValue,
      });

      await transaction.auditEvent.create({
        data: audit(
          context,
          'immunization-certificate.downloaded',
          'immunization',
          record.id,
          { childId, fingerprint: proof.fingerprint, anchorId: proof.anchorId },
        ),
      });

      return {
        buffer,
        filename: [
          safeFilenamePart(record.child.medfinetId),
          safeFilenamePart(record.vaccineCode),
          'vaccination-certificate.png',
        ].join('-'),
      };
    });
  }

  async function evidence(context, childId, immunizationId) {
    const settings = options.algorand || require('../config').algorand;
    const proof = await withTenantTransaction(
      database,
      context.organizationId,
      async (transaction) => {
        const record = await findRecord(
          transaction,
          context,
          childId,
          immunizationId,
        );
        const material = proofMaterial(record);
        const { anchorId, fingerprint, fingerprintVersion } = material;
        const receipt = await transaction.anchorReceipt.findFirst({
          where: { anchorId, tenantId: context.organizationId },
        });
        let queued = false;
        if (settings.enabled && !receipt) {
          queued = await queueMissingEvidence(transaction, record, material);
        }
        await transaction.auditEvent.create({
          data: audit(
            context,
            'immunization-certificate.evidence-viewed',
            'immunization',
            record.id,
            { childId, fingerprint, anchorId },
          ),
        });
        return {
          anchorId,
          eventCode: material.eventCode,
          fingerprint,
          fingerprintVersion,
          receipt,
          queued,
        };
      },
    );

    const base = {
      recordId: immunizationId,
      fingerprint: proof.fingerprint,
      fingerprintVersion: proof.fingerprintVersion,
      anchorId: proof.anchorId,
      queued: proof.queued,
      network: settings.enabled ? networkLabel(settings) : null,
      txId: proof.receipt?.txId || null,
      blockHeight: proof.receipt?.blockHeight == null
        ? null
        : String(proof.receipt.blockHeight),
      confirmedAt: proof.receipt?.confirmedAt || null,
      explorerUrl: null,
      receiptIntegrity: null,
      hashIntegrity: null,
      txIdIntegrity: null,
      noteIntegrity: null,
      transactionIntegrity: null,
      chainConfirmed: null,
    };
    if (!settings.enabled) return { ...base, status: 'DISABLED' };
    if (!proof.receipt) return { ...base, status: 'PENDING' };

    try {
      const inspected = await (options.inspectReceipt || defaultInspectReceipt)(
        proof.receipt,
        settings,
        {
          anchorId: proof.anchorId,
          eventCode: proof.eventCode,
          tenantId: context.organizationId,
        },
      );
      const integrityVerified = inspected.receiptIntegrity
        && inspected.hashIntegrity
        && inspected.txIdIntegrity
        && inspected.noteIntegrity
        && inspected.transactionIntegrity;
      const verified = Boolean(integrityVerified && inspected.chainConfirmed);
      return {
        ...base,
        ...inspected,
        verified,
        status: verified
          ? 'CONFIRMED'
          : integrityVerified
            ? 'UNCONFIRMED'
            : 'MISMATCH',
      };
    } catch (error) {
      logger.warn('certificate.algorand-proof-unavailable', {
        anchorId: proof.anchorId,
        errorType: error?.name || 'Error',
        errorCode: error?.code || null,
      });
      return { ...base, status: 'UNAVAILABLE' };
    }
  }

  return { create, evidence };
}

module.exports = {
  certificateFingerprint,
  createCertificateService,
  safeFilenamePart,
};
