const crypto = require('node:crypto');

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

function parseSignature(value) {
  const parts = Object.fromEntries(
    String(value || '')
      .split(',')
      .map((part) => part.split('=', 2))
      .filter(([key, item]) => key && item)
  );
  return { timestamp: parts.t, signature: parts.v1 };
}

function createNotificationWebhookAuth({
  secret,
  now = () => new Date(),
  maxAgeSeconds = MAX_WEBHOOK_AGE_SECONDS,
} = {}) {
  const signingSecret = secret || require('../config').notifications.webhookSecret;
  return function notificationWebhookAuth(req, res, next) {
    if (!signingSecret || !req.rawBody) {
      return res.status(401).json({
        success: false,
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Webhook signature is invalid',
      });
    }
    const { timestamp, signature } = parseSignature(
      req.get('x-medfinet-signature')
    );
    const epochSeconds = Number(timestamp);
    const age = Math.abs(Math.floor(now().getTime() / 1000) - epochSeconds);
    if (
      !Number.isInteger(epochSeconds)
      || age > maxAgeSeconds
      || typeof signature !== 'string'
      || !/^[a-f0-9]{64}$/.test(signature)
    ) {
      return res.status(401).json({
        success: false,
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Webhook signature is invalid',
      });
    }
    const expected = crypto
      .createHmac('sha256', signingSecret)
      .update(`${timestamp}.`)
      .update(req.rawBody)
      .digest('hex');
    const valid = crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
    if (!valid) {
      return res.status(401).json({
        success: false,
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Webhook signature is invalid',
      });
    }
    return next();
  };
}

module.exports = {
  createNotificationWebhookAuth,
  parseSignature,
  MAX_WEBHOOK_AGE_SECONDS,
};
