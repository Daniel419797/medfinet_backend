const { logger: defaultLogger } = require('../utils/logger');

function createUssdWebhookController({ engine, logger = defaultLogger } = {}) {
  let configuredEngine = engine;
  return async function africasTalking(req, res) {
    try {
      if (!configuredEngine) {
        const { createUssdEngine } = require('../services/ussdEngine');
        configuredEngine = createUssdEngine();
      }
      const result = await configuredEngine.handle(req.body);
      return res.status(200).type('text/plain').send(result);
    } catch (error) {
      logger.warn('ussd.request.failed', {
        requestId: req.requestId,
        errorCode: error.code || 'USSD_INTERNAL_ERROR',
        errorName: error.name,
      });
      const safe = error.code === 'USSD_SESSION_EXPIRED'
        ? 'END This session expired. Please dial again.'
        : 'END We could not complete this request. Please try again.';
      return res.status(200).type('text/plain').send(safe);
    }
  };
}

module.exports = {
  africasTalking: createUssdWebhookController(),
  createUssdWebhookController,
};
