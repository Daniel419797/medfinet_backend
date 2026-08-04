const crypto = require('node:crypto');

const MAX_WEBHOOK_AGE_SECONDS = 120;

function createUssdWebhookAuth({ secret, now = () => new Date() } = {}) {
  const signingSecret = secret || require('../config').ussd.webhookSecret;
  return function ussdWebhookAuth(req, res, next) {
    const timestamp = req.get('x-medfinet-ussd-timestamp');
    const signature = req.get('x-medfinet-ussd-signature');
    const epochSeconds = Number(timestamp);
    const age = Math.abs(Math.floor(now().getTime() / 1000) - epochSeconds);
    if (
      !signingSecret
      || !req.rawBody
      || !Number.isInteger(epochSeconds)
      || age > MAX_WEBHOOK_AGE_SECONDS
      || !/^[a-f0-9]{64}$/.test(String(signature || ''))
    ) {
      return res.status(401).type('text/plain').send('END Request authentication failed');
    }
    const expected = crypto.createHmac('sha256', signingSecret)
      .update(`${timestamp}.`)
      .update(req.rawBody)
      .digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) {
      return res.status(401).type('text/plain').send('END Request authentication failed');
    }
    return next();
  };
}

module.exports = { createUssdWebhookAuth, MAX_WEBHOOK_AGE_SECONDS };
