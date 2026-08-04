const { Router } = require('express');
const notificationsController = require('../controllers/notifications');
const { auth } = require('../middleware/auth');
const {
  createOrganizationAccessMiddleware,
} = require('../middleware/organizationAccess');
const { stepUpAuth } = require('../middleware/stepUpAuth');

const router = Router();
const readAccess = createOrganizationAccessMiddleware();
const administrationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN'],
});

router.post(
  '/notification-templates',
  auth,
  administrationAccess,
  notificationsController.createTemplate
);
router.get(
  '/notification-templates',
  auth,
  administrationAccess,
  notificationsController.listTemplates
);
router.post(
  '/notification-templates/:templateId/activate',
  auth,
  administrationAccess,
  stepUpAuth,
  notificationsController.activateTemplate
);
router.put(
  '/notification-preferences',
  auth,
  readAccess,
  notificationsController.upsertPreference
);
router.get(
  '/notification-preferences',
  auth,
  readAccess,
  notificationsController.listPreferences
);
router.get('/notifications', auth, readAccess, notificationsController.listInbox);
router.post(
  '/notifications/:messageId/read',
  auth,
  readAccess,
  notificationsController.markRead
);

module.exports = router;
