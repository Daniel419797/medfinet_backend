const { Router } = require('express');
const { auth } = require('../middleware/auth');
const {
  createOrganizationAccessMiddleware,
} = require('../middleware/organizationAccess');
const {
  createConsentAccessMiddleware,
} = require('../middleware/consentAccess');
const clinicalController = require('../controllers/clinical');

const router = Router();
const nutritionWorkerAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['NUTRITION_WORKER'],
});
const nutritionReadDisclosure = createConsentAccessMiddleware({
  scopes: [{ category: 'NUTRITION', access: 'READ' }],
});

router.get(
  '/children/:id/timeline',
  auth,
  nutritionWorkerAccess,
  nutritionReadDisclosure,
  clinicalController.getNutritionTimeline,
);

router.post(
  '/children/:id/growth-measurements',
  auth,
  nutritionWorkerAccess,
  clinicalController.recordGrowth,
);

router.patch(
  '/growth-measurements/:growthMeasurementId',
  auth,
  nutritionWorkerAccess,
  clinicalController.amendGrowth,
);

module.exports = router;
