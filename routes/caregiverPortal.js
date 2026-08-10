const { Router } = require('express');
const identityController = require('../controllers/identity');
const { auth } = require('../middleware/auth');
const { createOrganizationAccessMiddleware } = require('../middleware/organizationAccess');

const router = Router();
const administrationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN'],
});

router.post(
  '/caregivers/connect-parent',
  auth,
  administrationAccess,
  identityController.connectParent
);

module.exports = router;
