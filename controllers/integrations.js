const {
  createIntegrationConnectionService,
} = require('../services/integrationConnectionService');
const {
  createIntegrationMappingService,
} = require('../services/integrationMappingService');
const {
  createIntegrationJobService,
} = require('../services/integrationJobService');
const {
  createIntegrationImportReviewService,
} = require('../services/integrationImportReviewService');
const {
  createIntegrationReconciliationService,
} = require('../services/integrationReconciliationService');
const {
  createIntegrationQueryService,
} = require('../services/integrationQueryService');
const {
  createIntegrationAdapters,
  createIntegrationHealthChecker,
} = require('../services/integrationAdapters');

const adapters = createIntegrationAdapters();
const connectionService = createIntegrationConnectionService(undefined, {
  healthChecker: createIntegrationHealthChecker(adapters),
});
const mappingService = createIntegrationMappingService();
const jobService = createIntegrationJobService();
const importReviewService = createIntegrationImportReviewService();
const reconciliationService = createIntegrationReconciliationService(undefined, {
  adapters,
});
const queryService = createIntegrationQueryService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    role: req.organization.membership.role,
    purpose: req.accessPurpose,
    requestId: req.requestId,
  };
}

function handle(operation, status = 200) {
  return async (req, res, next) => {
    try {
      return res.status(status).json({
        success: true,
        data: await operation(req),
      });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  listConnections: handle(
    (req) => queryService.listConnections(context(req), req.query)
  ),
  listMappings: handle(
    (req) => queryService.listMappings(
      context(req),
      req.params.connectionId,
      req.query
    )
  ),
  listJobs: handle(
    (req) => queryService.listJobs(context(req), req.query)
  ),
  listReconciliations: handle(
    (req) => queryService.listReconciliations(context(req), req.query)
  ),
  createConnection: handle(
    (req) => connectionService.createConnection(context(req), req.body),
    201
  ),
  checkHealth: handle(
    (req) => connectionService.checkHealth(context(req), req.params.connectionId)
  ),
  activateConnection: handle(
    (req) => connectionService.activate(context(req), req.params.connectionId)
  ),
  suspendConnection: handle(
    (req) => connectionService.suspend(
      context(req),
      req.params.connectionId,
      req.body
    )
  ),
  createMapping: handle(
    (req) => mappingService.createMapping(
      context(req),
      req.params.connectionId,
      req.body
    ),
    201
  ),
  activateMapping: handle(
    (req) => mappingService.activateMapping(context(req), req.params.mappingId)
  ),
  startJob: handle(
    (req) => jobService.start(context(req), req.params.connectionId, req.body),
    202
  ),
  getJob: handle(
    (req) => jobService.get(context(req), req.params.jobId)
  ),
  cancelJob: handle(
    (req) => jobService.cancel(context(req), req.params.jobId, req.body)
  ),
  listImports: handle(
    (req) => importReviewService.list(context(req), req.query)
  ),
  revealImport: handle(
    (req) => importReviewService.reveal(context(req), req.params.stagingId)
  ),
  rejectImport: handle(
    (req) => importReviewService.reject(
      context(req),
      req.params.stagingId,
      req.body
    )
  ),
  applyImport: handle(
    (req) => importReviewService.apply(context(req), req.params.stagingId)
  ),
  startReconciliation: handle(
    (req) => reconciliationService.start(
      context(req),
      req.params.connectionId,
      req.body
    ),
    202
  ),
  getReconciliation: handle(
    (req) => queryService.getReconciliation(
      context(req),
      req.params.reconciliationId
    )
  ),
};
