const { Router } = require('express');
const controller = require('../controllers/analytics');
const { auth } = require('../middleware/auth');
const {
  createOrganizationAccessMiddleware,
} = require('../middleware/organizationAccess');
const { stepUpAuth } = require('../middleware/stepUpAuth');

const router = Router();
const analyticsReadAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN', 'AUDITOR'],
});
const analyticsAdministrationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN'],
});

router.get(
  '/analytics/publication-policy',
  auth,
  analyticsReadAccess,
  controller.getPolicy
);
router.put(
  '/analytics/publication-policy',
  auth,
  analyticsAdministrationAccess,
  stepUpAuth,
  controller.updatePolicy
);
router.post(
  '/analytics/generation-runs',
  auth,
  analyticsAdministrationAccess,
  controller.requestGeneration
);
router.get(
  '/analytics/latest',
  auth,
  analyticsReadAccess,
  controller.latestInternal
);
router.get(
  '/analytics/narrative',
  auth,
  analyticsReadAccess,
  controller.narrative
);

module.exports = router;
