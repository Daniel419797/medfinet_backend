const { logger } = require('../utils/logger');

function routePattern(req) {
  if (!req.route?.path) return 'unmatched';
  return `${req.baseUrl || ''}${req.route.path}`;
}

function httpLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('http.request.completed', {
      requestId: req.requestId,
      method: req.method,
      route: routePattern(req),
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  });
  return next();
}

module.exports = { httpLogger, routePattern };
