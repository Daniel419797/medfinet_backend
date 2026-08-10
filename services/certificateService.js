const { renderCertificate } = require('../controllers/certificate/certificate');
const { DomainError } = require('../utils/domainError');
const { logger } = require('../utils/logger');
const AnchorReceipt = require('./blockchain/AnchorReceipt');
const { EVENT_TYPES } = require('./blockchain/eventTypes');
const { inspectAnchorReceipt } = require('./blockchain/receiptVerification');
const CertificateNftRepository = require('./certificateNftRepository');
const {
  certificateNftOutboxData,
  inspectCertificateNftReceipt,
} = require('./certificateNftService');
const { audit } = require('./clinicalValidation');
const {
  amendedImmunizationAnchorId,
  fingerprintVersionFromAnchorId,
  recordedImmunizationAnchorId,
} = require('./immunizationIntegrity');
const {
  readImmunizationSnapshot,
  snapshotForEvidence,
} = require('./certificateMetadataService');
const { assertResourceScope } = require('./resourceScopeService');
const { withTenantTransaction } = require('./tenantContext');

const adapterCache = new WeakMap();

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
    fingerprintVersion: fingerprintVersionFromAnchorId(anchorId),
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

function adapterForSettings(settings) {
  const AlgorandAdapter = require('./blockchain/adapters/AlgorandAdapter');
  let adapter = adapterCache.get(settings);
  if (!adapter) {
    adapter = new AlgorandAdapter(settings);
    adapterCache.set(settings, adapter);
  }
  return adapter;
}

async function defaultInspectReceipt(receipt, settings, expected) {
  return inspectAnchorReceipt(
    AnchorReceipt.fromDatabase(receipt),
    adapterForSettings(settings),
    expected,
  );
}

async function defaultInspectNftReceipt(receipt, settings, expected) {
  return inspectCertificateNftReceipt(
    receipt,
    adapterForSettings(settings),
    expected,
  );
}

function networkSettingsForReceipt(settings, receipt) {
  if (!receipt?.network) return null;
  if (settings.network) {
    return settings.network === receipt.network ? settings : null;
  }
  if (settings.networks) {
    try {
      return require('./blockchain/networkRegistry').getNetworkConfig(receipt.network);
    } catch {
      return null;
    }
  }
  return Object.freeze({ ...settings, network: receipt.network });
}

async function queueMissingEvidence(transaction, record, proof, currentTime) {
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
  if (existing.status !== 'PUBLISHED') return false;
  if (
    existing.nextAttemptAt
    && new Date(existing.nextAttemptAt).valueOf() > currentTime.valueOf()
  ) return false;

  const recovered = await transaction.outboxEvent.updateMany({
    where: {
      id: existing.id,
      organizationId: record.organizationId,
      status: existing.status,
      attempts: existing.attempts,
      nextAttemptAt: { lte: currentTime },
    },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: currentTime,
      lockedAt: null,
      lockedBy: null,
      publishedAt: null,
      lastError: null,
    },
  });
  return recovered.count === 1;
}

function nftReceiptStoreAvailable(transaction) {
  return typeof transaction?.$queryRawUnsafe === 'function'
    && typeof transaction?.$executeRawUnsafe === 'function';
}

async function queueMissingNftEvidence(transaction, record, proof) {
  const outboxData = certificateNftOutboxData(record, proof);
  const where = {
    organizationId_idempotencyKey: {
      organizationId: record.organizationId,
      idempotencyKey: outboxData.idempotencyKey,
    },
  };
  const existing = await transaction.outboxEvent.findUnique({ where });
  if (existing) {
    return { queued: false, outboxStatus: existing.status };
  }
  await transaction.outboxEvent.upsert({
    where,
    create: outboxData,
    update: {},
  });
  return { queued: true, outboxStatus: 'PENDING' };
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
    const snapshot = await readImmunizationSnapshot(
      transaction,
      context,
      record.id,
    );
    return {
      ...record,
      certificateMetadata: snapshotForEvidence(snapshot),
    };
  }

  async function ensureNftQueued(transaction, settings, record, proof) {
    if (!settings.enabled || !nftReceiptStoreAvailable(transaction)) {
      return { receipt: null, queued: false, outboxStatus: null, storeAvailable: false };
    }
    const repository = new CertificateNftRepository(transaction);
    const receipt = await repository.findByProofId(record.organizationId, proof.anchorId);
    if (receipt) {
      return { receipt, queued: false, outboxStatus: 'PUBLISHED', storeAvailable: true };
    }
    const queue = await queueMissingNftEvidence(transaction, record, proof);
    return {
      receipt: null,
      queued: queue.queued,
      outboxStatus: queue.outboxStatus,
      storeAvailable: true,
    };
  }

  async function create(context, childId, immunizationId) {
    const settings = options.algorand || require('../config').algorand;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const record = await findRecord(
        transaction,
        context,
        childId,
        immunizationId,
      );

      const proof = proofMaterial(record);
      await ensureNftQueued(transaction, settings, record, proof);
      const verificationValue = JSON.stringify({
        type: 'MEDFINET_VACCINATION_CERTIFICATE',
        version: 3,
        recordId: record.id,
        fingerprint: proof.fingerprint,
        fingerprintVersion: proof.fingerprintVersion,
        algorandAnchorId: proof.anchorId,
      });
      const metadata = record.certificateMetadata;
      const buffer = await renderer({
        childName: `${record.child.firstName} ${record.child.lastName}`,
        childDOB: record.child.dateOfBirth,
        sex: record.child.sex,
        state: metadata?.state || record.facility?.administrativeArea || '',
        lga: metadata?.lga || '',
        ward: metadata?.ward || '',
        location: metadata?.facilityName || record.facility?.name || '',
        provider: metadata?.vaccinatorName || '',
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
          const currentTime = options.now ? options.now() : new Date();
          queued = await queueMissingEvidence(
            transaction,
            record,
            material,
            currentTime,
          );
        }
        const nftState = await ensureNftQueued(
          transaction,
          settings,
          record,
          material,
        );
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
          nftReceipt: nftState.receipt,
          nftQueued: nftState.queued,
          nftOutboxStatus: nftState.outboxStatus,
          nftStoreAvailable: nftState.storeAvailable,
        };
      },
    );

    const nftSettings = proof.nftReceipt
      ? networkSettingsForReceipt(settings, proof.nftReceipt)
      : settings;
    const nftBase = {
      status: 'UNAVAILABLE',
      reason: null,
      queued: proof.nftQueued,
      assetId: proof.nftReceipt?.assetId == null ? null : String(proof.nftReceipt.assetId),
      mintTxId: proof.nftReceipt?.txId || null,
      blockHeight: proof.nftReceipt?.blockHeight == null
        ? null
        : String(proof.nftReceipt.blockHeight),
      confirmedAt: proof.nftReceipt?.confirmedAt || null,
      network: settings.enabled && nftSettings ? networkLabel(nftSettings) : null,
      networkId: proof.nftReceipt?.network || settings.network || settings.defaultNetwork || null,
      explorerUrl: null,
      receiptIntegrity: null,
      networkIntegrity: null,
      transactionIntegrity: null,
      assetIntegrity: null,
      metadataIntegrity: null,
      supplyIntegrity: null,
      immutableIntegrity: null,
      chainConfirmed: null,
      verified: false,
    };

    let nftEvidence;
    if (!settings.enabled) {
      nftEvidence = { ...nftBase, status: 'DISABLED' };
    } else if (!proof.nftStoreAvailable) {
      nftEvidence = {
        ...nftBase,
        status: 'UNAVAILABLE',
        reason: 'NFT_RECEIPT_STORE_UNAVAILABLE',
      };
    } else if (!proof.nftReceipt) {
      const terminal = ['PUBLISHED', 'DEAD_LETTER'].includes(proof.nftOutboxStatus);
      nftEvidence = {
        ...nftBase,
        status: terminal ? 'UNAVAILABLE' : 'PENDING',
        reason: proof.nftOutboxStatus === 'PUBLISHED'
          ? 'NFT_RECEIPT_MISSING'
          : proof.nftOutboxStatus === 'DEAD_LETTER'
            ? 'NFT_MINT_FAILED'
            : null,
      };
    } else if (!proof.nftReceipt.network || !nftSettings) {
      nftEvidence = {
        ...nftBase,
        status: 'UNAVAILABLE',
        reason: 'NFT_NETWORK_UNAVAILABLE',
      };
    } else {
      try {
        nftEvidence = {
          ...nftBase,
          ...await (options.inspectNftReceipt || defaultInspectNftReceipt)(
            proof.nftReceipt,
            nftSettings,
            {
              organizationId: context.organizationId,
              immunizationId,
              proofId: proof.anchorId,
              fingerprint: proof.fingerprint,
              fingerprintVersion: proof.fingerprintVersion,
              network: proof.nftReceipt.network,
            },
          ),
        };
      } catch (error) {
        logger.warn('certificate.algorand-nft-proof-unavailable', {
          assetId: proof.nftReceipt?.assetId == null
            ? null
            : String(proof.nftReceipt.assetId),
          errorType: error?.name || 'Error',
          errorCode: error?.code || null,
        });
        nftEvidence = {
          ...nftBase,
          status: 'UNAVAILABLE',
          reason: 'NFT_VERIFICATION_UNAVAILABLE',
        };
      }
    }

    const receiptSettings = proof.receipt
      ? networkSettingsForReceipt(settings, proof.receipt)
      : settings;
    const base = {
      recordId: immunizationId,
      fingerprint: proof.fingerprint,
      fingerprintVersion: proof.fingerprintVersion,
      anchorId: proof.anchorId,
      queued: proof.queued,
      network: settings.enabled && receiptSettings ? networkLabel(receiptSettings) : null,
      networkId: proof.receipt?.network || settings.network || settings.defaultNetwork || null,
      txId: proof.receipt?.txId || null,
      blockHeight: proof.receipt?.blockHeight == null
        ? null
        : String(proof.receipt.blockHeight),
      confirmedAt: proof.receipt?.confirmedAt || null,
      explorerUrl: null,
      receiptIntegrity: null,
      networkIntegrity: null,
      hashIntegrity: null,
      txIdIntegrity: null,
      noteIntegrity: null,
      transactionIntegrity: null,
      transactionLocated: null,
      chainConfirmed: null,
      reason: null,
      nft: nftEvidence,
    };
    if (!settings.enabled) return { ...base, status: 'DISABLED' };
    if (!proof.receipt) return { ...base, status: 'PENDING' };
    if (!proof.receipt.network) {
      return { ...base, status: 'UNAVAILABLE', reason: 'ANCHOR_NETWORK_UNKNOWN' };
    }
    if (!receiptSettings) {
      return { ...base, status: 'UNAVAILABLE', reason: 'ANCHOR_NETWORK_UNAVAILABLE' };
    }

    try {
      const inspected = await (options.inspectReceipt || defaultInspectReceipt)(
        proof.receipt,
        receiptSettings,
        {
          anchorId: proof.anchorId,
          eventCode: proof.eventCode,
          tenantId: context.organizationId,
          network: proof.receipt.network,
        },
      );
      return {
        ...base,
        ...inspected,
        nft: nftEvidence,
      };
    } catch (error) {
      logger.warn('certificate.algorand-proof-unavailable', {
        anchorId: proof.anchorId,
        errorType: error?.name || 'Error',
        errorCode: error?.code || null,
      });
      return { ...base, status: 'UNAVAILABLE', nft: nftEvidence };
    }
  }

  return { create, evidence };
}

module.exports = {
  certificateFingerprint,
  createCertificateService,
  safeFilenamePart,
};