const { Router } = require('express');
const controller = require('../controllers/integrations');
const aiController = require('../controllers/ai');
const { auth } = require('../middleware/auth');
const {
  createOrganizationAccessMiddleware,
} = require('../middleware/organizationAccess');
const { stepUpAuth } = require('../middleware/stepUpAuth');

const router = Router();
const administrationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN'],
});
const integrationReadAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN', 'AUDITOR'],
});

router.post(
  '/integration-connections',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.createConnection
);
router.get(
  '/integration-connections',
  auth,
  integrationReadAccess,
  controller.listConnections
);
router.post(
  '/integration-connections/:connectionId/health',
  auth,
  administrationAccess,
  controller.checkHealth
);
router.post(
  '/integration-connections/:connectionId/activate',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.activateConnection
);
router.post(
  '/integration-connections/:connectionId/suspend',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.suspendConnection
);
router.post(
  '/integration-connections/:connectionId/mappings',
  auth,
  administrationAccess,
  controller.createMapping
);
router.get(
  '/integration-connections/:connectionId/mappings',
  auth,
  integrationReadAccess,
  controller.listMappings
);
router.post(
  '/integration-mappings/:mappingId/activate',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.activateMapping
);
router.post(
  '/integration-mapping-assist',
  auth,
  administrationAccess,
  aiController.suggestMapping
);
router.post(
  '/integration-connections/:connectionId/jobs',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.startJob
);
router.get(
  '/integration-jobs',
  auth,
  integrationReadAccess,
  controller.listJobs
);
router.get(
  '/integration-jobs/:jobId',
  auth,
  integrationReadAccess,
  controller.getJob
);
router.post(
  '/integration-jobs/:jobId/cancel',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.cancelJob
);
router.get(
  '/integration-imports',
  auth,
  integrationReadAccess,
  controller.listImports
);
router.get(
  '/integration-imports/:stagingId',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.revealImport
);
router.post(
  '/integration-imports/:stagingId/reject',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.rejectImport
);
router.post(
  '/integration-imports/:stagingId/apply',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.applyImport
);
router.post(
  '/integration-connections/:connectionId/reconciliations',
  auth,
  administrationAccess,
  stepUpAuth,
  controller.startReconciliation
);
router.get(
  '/integration-reconciliations',
  auth,
  integrationReadAccess,
  controller.listReconciliations
);
router.get(
  '/integration-reconciliations/:reconciliationId',
  auth,
  integrationReadAccess,
  controller.getReconciliation
);

module.exports = router;
