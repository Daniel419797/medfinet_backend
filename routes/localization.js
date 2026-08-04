const { Router } = require('express');
const controller = require('../controllers/localization');
const aiController = require('../controllers/ai');
const { auth } = require('../middleware/auth');
const {
  createOrganizationAccessMiddleware,
} = require('../middleware/organizationAccess');
const { stepUpAuth } = require('../middleware/stepUpAuth');

const router = Router();
const localizationReadAccess = createOrganizationAccessMiddleware();
const localizationAdministrationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN'],
});

router.get(
  '/localization/catalogs/:locale',
  auth,
  localizationReadAccess,
  controller.catalog
);
router.post(
  '/localization/content',
  auth,
  localizationAdministrationAccess,
  controller.createDraft
);
router.post(
  '/localization/ai/translate',
  auth,
  localizationAdministrationAccess,
  aiController.generateTranslation
);
router.get(
  '/localization/content',
  auth,
  localizationAdministrationAccess,
  controller.listContent
);
router.post(
  '/localization/content/:contentId/activate',
  auth,
  localizationAdministrationAccess,
  stepUpAuth,
  controller.activate
);

module.exports = router;
