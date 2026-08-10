const os = require('node:os');
const { prisma } = require('../utils/prisma');
const { DomainError } = require('../utils/domainError');
const { createOutboxService } = require('../services/outboxService');
const { createSyncService } = require('../services/syncService');
const { createSyncHandlers } = require('../services/syncHandlers');
const {
  createWorklistGenerationService,
} = require('../services/worklistGenerationService');
const {
  createNotificationQueueService,
} = require('../services/notificationQueueService');
const {
  createNotificationDispatchService,
} = require('../services/notificationDispatchService');
const {
  createIntegrationProcessor,
} = require('../services/integrationProcessor');
const {
  createAnalyticsGenerationService,
} = require('../services/analyticsGenerationService');
const { logger } = require('../utils/logger');
const { createNfcLifecycleService } = require('../services/nfcLifecycleService');
const { withTenantTransaction } = require('../services/tenantContext');
const config = require('../config');
const BlockchainAnchorService = require('../services/blockchain/BlockchainAnchorService');
const AlgorandAdapter = require('../services/blockchain/adapters/AlgorandAdapter');
const AnchorReceiptRepository = require('../services/anchorReceiptRepository');
const CertificateNftRepository = require('../services/certificateNftRepository');
const { createCertificateNftService } = require('../services/certificateNftService');
const { createCertificateNftQueueService } = require('../services/certificateNftQueueService');
const { getNetworkConfig } = require('../services/blockchain/networkRegistry');

const runOnce = process.argv.includes('--once');
const workerId = `${os.hostname()}:${process.pid}`;
const pollIntervalMs = 1000;
let stopping = false;
let lastRateLimitCleanupAt = 0;
let lastNfcCleanupAt = 0;

function workerContext(organizationId) {
  return {
    organizationId,
    actorSubjectId: `system:${workerId}`,
    role: 'ADMIN',
    purpose: 'background-processing',
    requestId: workerId,
  };
}

async function processOrganization(organizationId) {
  const context = workerContext(organizationId);
  const syncService = createSyncService(prisma, {
    handlers: createSyncHandlers(prisma),
  });
  const notificationQueue = createNotificationQueueService(prisma);
  const notificationDispatch = createNotificationDispatchService(prisma);
  const integrationProcessor = createIntegrationProcessor(prisma);
  const analyticsGeneration = createAnalyticsGenerationService(prisma);
  const receiptStore = new AnchorReceiptRepository();
  const certificateNftQueue = createCertificateNftQueueService(prisma);
  let anchorService = null;
  let certificateNftAdapter = null;
  if (config.algorand.enabled) {
    const selectedConfig = getNetworkConfig();
    certificateNftAdapter = new AlgorandAdapter(selectedConfig);
    anchorService = new BlockchainAnchorService(certificateNftAdapter, receiptStore, {
      enabled: true,
      fee: selectedConfig.fee,
    });
  }
  const queueNotification = async (_handlerContext, event) => {
    await notificationQueue.queueOutboxEvent(context, event);
  };
  const outbox = createOutboxService(prisma, {
    excludedEventTypes: config.algorand.enabled
      ? []
      : ['BLOCKCHAIN_ANCHOR_REQUESTED', 'BLOCKCHAIN_CERTIFICATE_NFT_REQUESTED'],
    handlers: {
      SYNC_BATCH_ACCEPTED: async (_handlerContext, event) => {
        await syncService.processBatch(context, event.payload.syncBatchId);
      },
      WORKLIST_GENERATION_REQUESTED: async (_handlerContext, event) => {
        await createWorklistGenerationService(prisma).processGenerationBatch(
          context,
          event.payload.worklistId
        );
      },
      REWARD_GRANTED: queueNotification,
      REWARD_REDEEMED: queueNotification,
      SETTLEMENT_PAID: queueNotification,
      APPOINTMENT_SCHEDULED: queueNotification,
      APPOINTMENT_STATUS_CHANGED: queueNotification,
      REFERRAL_OPENED: queueNotification,
      REFERRAL_STATUS_CHANGED: queueNotification,
      EMERGENCY_ACCESS_ACTIVATED: queueNotification,
      VACCINE_DUE: queueNotification,
      NOTIFICATION_DISPATCH_REQUESTED: async (_handlerContext, event) => {
        await notificationDispatch.dispatch(
          context,
          event.payload.notificationMessageId
        );
      },
      INTEGRATION_JOB_REQUESTED: async (_handlerContext, event) => {
        await integrationProcessor.processBatch(
          context,
          event.payload.integrationJobId
        );
      },
      INTEGRATION_RECONCILIATION_REQUESTED: async (_handlerContext, event) => {
        await integrationProcessor.processReconciliation(
          context,
          event.payload.reconciliationRunId
        );
      },
      ANALYTICS_GENERATION_REQUESTED: async (_handlerContext, event) => {
        await analyticsGeneration.process(
          context,
          event.payload.analyticsGenerationRunId
        );
      },
      BLOCKCHAIN_ANCHOR_REQUESTED: async (_handlerContext, event) => {
        if (!anchorService) {
          logger.info('blockchain.anchor.skipped', { reason: 'disabled' });
          return;
        }
        const { eventCode, anchorId, tenantId } = event.payload;
        if (tenantId !== context.organizationId) {
          throw new DomainError(
            409,
            'BLOCKCHAIN_TENANT_MISMATCH',
            'Blockchain anchor request is not bound to the claimed organization',
          );
        }
        const receipt = await anchorService.anchorEvent(eventCode, anchorId, tenantId);
        let nftQueue = { queued: false, reason: 'QUEUE_NOT_ATTEMPTED' };
        try {
          nftQueue = await certificateNftQueue.queueFromAnchorEvent(context, event);
        } catch (error) {
          nftQueue = { queued: false, reason: 'QUEUE_FAILED' };
          logger.warn('blockchain.certificate-nft.queue-failed', {
            anchorId,
            eventCode,
            errorCode: error?.code || null,
            errorType: error?.name || 'Error',
          });
        }
        logger.info('blockchain.anchor.confirmed', {
          anchorId,
          eventCode,
          txId: receipt.txId,
          certificateNftQueued: nftQueue.queued,
          certificateNftReason: nftQueue.reason || null,
        });
      },
      BLOCKCHAIN_CERTIFICATE_NFT_REQUESTED: async (_handlerContext, event) => {
        if (!certificateNftAdapter) {
          logger.info('blockchain.certificate-nft.skipped', { reason: 'disabled' });
          return;
        }
        if (event.payload.tenantId !== context.organizationId) {
          throw new DomainError(
            409,
            'CERTIFICATE_NFT_TENANT_MISMATCH',
            'Certificate NFT request is not bound to the claimed organization',
          );
        }
        const receipt = await withTenantTransaction(
          prisma,
          context.organizationId,
          async (transaction) => createCertificateNftService(
            certificateNftAdapter,
            new CertificateNftRepository(transaction),
          ).mint({
            organizationId: context.organizationId,
            immunizationId: event.payload.immunizationId,
            proofId: event.payload.proofId,
            fingerprint: event.payload.fingerprint,
            fingerprintVersion: event.payload.fingerprintVersion,
          }),
        );
        logger.info('blockchain.certificate-nft.confirmed', {
          assetId: String(receipt.assetId),
          txId: receipt.txId,
          network: receipt.network,
        });
      },
    },
  });
  return outbox.processNext(context, workerId);
}

async function processAvailableEvents() {
  if (Date.now() - lastRateLimitCleanupAt >= 60 * 1000) {
    await prisma.$executeRawUnsafe(
      'DELETE FROM "security_rate_limit_buckets" WHERE "expiresAt" < NOW()'
    );
    lastRateLimitCleanupAt = Date.now();
  }
  const organizations = await prisma.organization.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (Date.now() - lastNfcCleanupAt >= 60 * 1000) {
    const nfcLifecycle = createNfcLifecycleService(prisma);
    for (const { id } of organizations) {
      await nfcLifecycle.expireOrganization(id);
    }
    lastNfcCleanupAt = Date.now();
  }
  let processed = 0;
  for (const organization of organizations) {
    if (stopping) break;
    const result = await processOrganization(organization.id);
    if (result.processed) processed += 1;
  }
  return processed;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  do {
    const processed = await processAvailableEvents();
    if (runOnce || stopping) break;
    if (processed === 0) await wait(pollIntervalMs);
  } while (!stopping);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
  });
}

main()
  .catch((error) => {
    logger.error('outbox-worker.failed', {
      errorName: error.name,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
