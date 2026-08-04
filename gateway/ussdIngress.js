const crypto = require('node:crypto');
const express = require('express');

function safeTokenMatch(candidate, expected) {
  const left = Buffer.from(String(candidate || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function createUssdIngressApp(options = {}) {
  const runtimeConfig = options.settings ? null : require('../config');
  const settings = options.settings || runtimeConfig.ussd;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logger = options.logger || require('../utils/logger').logger;
  const app = express();
  const buckets = new Map();
  app.set('trust proxy', options.trustProxyHops ?? runtimeConfig?.security.trustProxyHops ?? 0);
  app.use(express.urlencoded({
    extended: false,
    limit: '16kb',
    verify(req, _res, buffer) { req.rawBody = Buffer.from(buffer); },
  }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/callback/:token', async (req, res) => {
    if (!safeTokenMatch(req.params.token, settings.providerCallbackToken)) {
      return res.status(404).type('text/plain').send('Not found');
    }
    const now = Date.now();
    const key = crypto.createHmac('sha256', settings.webhookSecret)
      .update(req.ip || 'unknown').digest('hex');
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + 60_000 });
    else if (++bucket.count > 60) return res.status(429).type('text/plain').send('END Please try again later');
    const timestamp = String(Math.floor(now / 1000));
    const signature = crypto.createHmac('sha256', settings.webhookSecret)
      .update(`${timestamp}.`).update(req.rawBody).digest('hex');
    try {
      const upstream = await fetchImpl(settings.backendWebhookUrl, {
        method: 'POST',
        headers: {
          'content-type': req.get('content-type') || 'application/x-www-form-urlencoded',
          'x-medfinet-ussd-timestamp': timestamp,
          'x-medfinet-ussd-signature': signature,
        },
        body: req.rawBody,
        signal: AbortSignal.timeout(8_000),
      });
      const text = await upstream.text();
      if (!upstream.ok || !/^(CON|END)\s/.test(text) || text.length > 182) {
        throw new Error('Invalid upstream response');
      }
      return res.status(200).type('text/plain').send(text);
    } catch (error) {
      logger.error('ussd.ingress.failed', { errorName: error.name });
      return res.status(200).type('text/plain').send('END Service temporarily unavailable');
    }
  });
  return app;
}

if (require.main === module) {
  const runtimeConfig = require('../config');
  const runtimeLogger = require('../utils/logger').logger;
  createUssdIngressApp({ settings: runtimeConfig.ussd }).listen(runtimeConfig.ussd.ingressPort, () => {
    runtimeLogger.info('ussd.ingress.started', { port: runtimeConfig.ussd.ingressPort });
  });
}

module.exports = { createUssdIngressApp, safeTokenMatch };
