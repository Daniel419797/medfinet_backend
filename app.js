const config = require('./config');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const identityRoutes = require('./routes/identity');
const caregiverPortalRoutes = require('./routes/caregiverPortal');
const blockchainRoutes = require('./routes/blockchain');
const webhookRoutes = require('./routes/webhooks');
const publicRoutes = require('./routes/public');
const campaignRoutes = require('./routes/campaignRoutes');
const donationRoutes = require('./routes/donationRoutes');
const escrowRoutes = require('./routes/escrowRoutes');
const telemedicineRoutes = require('./routes/telemedicine');
const insuranceRoutes = require('./routes/insurance');
const invoiceRoutes = require('./routes/invoices');
const designRoutes = require('./routes/designs');
const hospitalRoutes = require('./routes/hospitals');
const healthWorkerRoutes = require('./routes/healthWorkers');
const nutritionRoutes = require('./routes/nutrition');
const { prisma } = require('./utils/prisma');
const { requestContext } = require('./middleware/requestContext');
const { createRateLimitMiddleware } = require('./middleware/rateLimit');
const { httpLogger } = require('./middleware/httpLogger');
const { logger } = require('./utils/logger');

const app = express();
app.set('trust proxy', config.security.trustProxyHops);
app.set('json replacer', (_key, value) => (
  typeof value === 'bigint' ? value.toString() : value
));

// Middleware
app.use(requestContext);
app.use(httpLogger);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({
  limit: config.requestBodyLimit,
  verify(req, _res, buffer) {
    req.rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({
  extended: true,
  limit: config.requestBodyLimit,
  verify(req, _res, buffer) {
    req.rawBody = Buffer.from(buffer);
  },
}));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ status: 'ready' });
  } catch (error) {
    logger.error('readiness.failed', {
      requestId: req.requestId,
      errorName: error.name,
    });
    return res.status(503).json({ status: 'not_ready' });
  }
});

// Routes
app.use(createRateLimitMiddleware({
  scope: 'api',
  limit: 600,
  windowMs: 60 * 1000,
}));
app.use(
  '/api/v1/webhooks',
  createRateLimitMiddleware({
    scope: 'webhooks',
    limit: 300,
    windowMs: 60 * 1000,
  }),
  webhookRoutes
);
app.use(
  '/api/v1/public',
  createRateLimitMiddleware({
    scope: 'public',
    limit: 120,
    windowMs: 60 * 1000,
  }),
  publicRoutes
);
app.use('/api/v1', caregiverPortalRoutes);
app.use('/api/v1', identityRoutes);
app.use('/api/v1', blockchainRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/donations', donationRoutes);
app.use('/api/v1/escrow', escrowRoutes);
app.use('/api/v1/telemedicine', telemedicineRoutes);
app.use('/api/v1/insurance', insuranceRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
app.use('/api/v1/designs', designRoutes);
app.use('/api/v1/hospitals', hospitalRoutes);
app.use('/api/v1/health-workers', healthWorkerRoutes);
app.use('/api/v1/nutrition', nutritionRoutes);

// Error handling
app.use((err, req, res, next) => {
  logger.error('http.request.failed', {
    requestId: req.requestId,
    errorName: err.name,
    errorCode: err.code || 'INTERNAL_ERROR',
    statusCode: err.status || 500,
  });
  if (err.name === 'DomainError') {
      return res.status(err.status).json({
        success: false,
        code: err.code,
        message: err.message,
        requestId: req.requestId,
        ...(err.details ? { details: err.details } : {}),
      });
  }
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    requestId: req.requestId,
    error: config.nodeEnv === 'development' ? err.message : 'Something went wrong',
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    requestId: req.requestId,
  });
});

// Start server
if (require.main === module) {
  app.listen(config.port, () => {
    logger.info('api.started', { port: config.port });
  });
}

module.exports = app;
