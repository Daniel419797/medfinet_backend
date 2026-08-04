const { Router } = require('express');
const analyticsController = require('../controllers/analytics');
const localizationController = require('../controllers/localization');
const nfcController = require('../controllers/nfc');
const { createRateLimitMiddleware } = require('../middleware/rateLimit');

const router = Router();

router.get('/locales', localizationController.supported);

router.post(
  '/nfc/taps/:publicId/recognize',
  createRateLimitMiddleware({
    scope: 'nfc-public-tap',
    limit: 20,
    windowMs: 60 * 1000,
  }),
  nfcController.verifyPublicTap
);

router.get(
  '/organizations/:organizationSlug/metrics',
  analyticsController.publicMetrics
);

module.exports = router;
