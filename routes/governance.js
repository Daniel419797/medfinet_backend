const { Router } = require('express');
const controller = require('../controllers/governance');
const { auth } = require('../middleware/auth');
const {
  createOrganizationAccessMiddleware,
} = require('../middleware/organizationAccess');
const { stepUpAuth } = require('../middleware/stepUpAuth');

const router = Router();
const governanceReadAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN', 'AUDITOR'],
});
const governanceAdministrationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN'],
});
const subjectRequestAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN', 'AUDITOR', 'CAREGIVER'],
});

router.get(
  '/governance/audit-events',
  auth,
  governanceReadAccess,
  controller.listAuditEvents
);

router.get(
  '/governance/retention-policies',
  auth,
  governanceReadAccess,
  controller.listRetentionPolicies
);
router.post(
  '/governance/retention-policies',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.createRetentionPolicy
);
router.post(
  '/governance/retention-policies/:policyId/activate',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.activateRetentionPolicy
);
router.post(
  '/governance/retention-policies/:policyId/previews',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.previewRetention
);
router.post(
  '/governance/retention-runs/:runId/approve',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.approveRetention
);
router.post(
  '/governance/retention-runs/:runId/execute',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.executeRetention
);
router.get(
  '/governance/legal-holds',
  auth,
  governanceReadAccess,
  controller.listLegalHolds
);
router.post(
  '/governance/legal-holds',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.placeLegalHold
);
router.post(
  '/governance/legal-holds/:holdId/release',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.releaseLegalHold
);
router.get(
  '/governance/data-subject-requests',
  auth,
  subjectRequestAccess,
  controller.listSubjectRequests
);
router.post(
  '/governance/data-subject-requests',
  auth,
  subjectRequestAccess,
  controller.submitSubjectRequest
);
router.post(
  '/governance/data-subject-requests/:requestId/verify',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.verifySubjectRequest
);
router.post(
  '/governance/data-subject-requests/:requestId/decide',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.decideSubjectRequest
);
router.post(
  '/governance/data-subject-requests/:requestId/complete',
  auth,
  governanceAdministrationAccess,
  stepUpAuth,
  controller.completeSubjectRequest
);

module.exports = router;
