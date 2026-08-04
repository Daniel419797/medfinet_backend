const { Router } = require('express');
const controller = require('../controllers/notificationWebhooks');
const {
  createNotificationWebhookAuth,
} = require('../middleware/notificationWebhookAuth');
const ussdController = require('../controllers/ussdWebhook');
const { createUssdWebhookAuth } = require('../middleware/ussdWebhookAuth');

const router = Router();

router.post(
  '/notifications/delivery',
  createNotificationWebhookAuth(),
  controller.delivery
);

router.post(
  '/sms/bulksms-nigeria',
  controller.bulksmsDelivery
);

router.post(
  '/ussd/africas-talking',
  createUssdWebhookAuth(),
  ussdController.africasTalking
);

module.exports = router;
