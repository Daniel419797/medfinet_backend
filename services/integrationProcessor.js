const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { createIntegrationAdapters } = require('./integrationAdapters');
const { createIntegrationExportService } = require('./integrationExportService');
const { createIntegrationImportService } = require('./integrationImportService');
const {
  createIntegrationReconciliationService,
} = require('./integrationReconciliationService');

function createIntegrationProcessor(prismaClient, { adapters } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const configuredAdapters = adapters || createIntegrationAdapters();
  const exportService = createIntegrationExportService(database, {
    adapters: configuredAdapters,
  });
  const importService = createIntegrationImportService(database, {
    adapters: configuredAdapters,
  });
  const reconciliationService = createIntegrationReconciliationService(database, {
    adapters: configuredAdapters,
  });

  async function processBatch(context, jobId) {
    const job = await withTenantTransaction(
      database,
      context.organizationId,
      (transaction) => transaction.integrationJob.findFirst({
        where: { id: jobId, organizationId: context.organizationId },
        select: { direction: true },
      })
    );
    if (!job) {
      throw new DomainError(404, 'INTEGRATION_JOB_NOT_FOUND', 'Integration job not found');
    }
    return job.direction === 'EXPORT'
      ? exportService.processBatch(context, jobId)
      : importService.processBatch(context, jobId);
  }

  async function processReconciliation(context, runId) {
    return reconciliationService.processBatch(context, runId);
  }

  return { processBatch, processReconciliation };
}

module.exports = { createIntegrationProcessor };
