const { createNotificationDispatchService } = require('../services/notificationDispatchService');
const { requiredText } = require('../services/identityService');

const dispatchService = createNotificationDispatchService();

async function delivery(req, res, next) {
  try {
    const organizationId = requiredText(
      req.body.organizationId,
      'organizationId',
      100
    );
    const message = await dispatchService.markDelivered(
      {
        organizationId,
        actorSubjectId: 'system:notification-gateway',
        purpose: 'notification-delivery-callback',
        requestId: req.requestId,
      },
      'notification-gateway',
      requiredText(req.body.messageId, 'messageId', 200)
    );
    return res.status(200).json({
      success: true,
      data: { notificationMessageId: message.id, status: message.status },
    });
  } catch (error) {
    return next(error);
  }
}

async function bulksmsDelivery(req, res, next) {
  try {
    const { message_id, status, recipient } = req.body;
    if (!message_id) {
      return res.status(200).json({ success: true, data: { acknowledged: true } });
    }
    const delivered = status === 'delivrd' || status === 'delivered';
    if (!delivered) {
      return res.status(200).json({ success: true, data: { acknowledged: true } });
    }
    const message = await dispatchService.markDelivered(
      {
        organizationId: req.query.org || 'default',
        actorSubjectId: 'system:bulksms-nigeria',
        purpose: 'sms-delivery-callback',
        requestId: req.requestId,
      },
      'bulksmsnigeria',
      message_id
    );
    return res.status(200).json({
      success: true,
      data: { notificationMessageId: message.id, status: message.status },
    });
  } catch {
    return res.status(200).json({ success: true, data: { acknowledged: true } });
  }
}

module.exports = { delivery, bulksmsDelivery };
