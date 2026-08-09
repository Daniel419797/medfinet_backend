const { createNfcProvisioningService } = require('../services/nfcProvisioningService');
const { createNfcActivationService } = require('../services/nfcActivationService');
const { createNfcTapService } = require('../services/nfcTapService');
const { createNfcPublicTapService } = require('../services/nfcPublicTapService');
const { createNfcLifecycleService } = require('../services/nfcLifecycleService');
const { logger } = require('../utils/logger');

const provisioningService = createNfcProvisioningService();
const activationService = createNfcActivationService();
const tapService = createNfcTapService();
const publicTapService = createNfcPublicTapService();
const lifecycleService = createNfcLifecycleService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    role: req.organization.membership.role,
    membershipId: req.organization.membership.id,
    purpose: req.accessPurpose,
  };
}

function authenticatedSubjectContext(req) {
  return {
    actorSubjectId: req.user?.id || req.user?.sub || req.user?.hospital_id,
    purpose: String(req.get('x-access-purpose') || 'nfc-card-resolution')
      .trim()
      .slice(0, 120),
  };
}

function handle(operation, status = 200) {
  return async (req, res, next) => {
    try {
      return res.status(status).json({
        success: true,
        data: await operation(req),
      });
    } catch (error) {
      logger.warn('nfc.operation.failed', {
        code: error.code || 'NFC_UNEXPECTED_ERROR',
        status: error.status || error.statusCode || 500,
        route: String(req.route?.path || 'unknown'),
        requestId: req.requestId || null,
      });
      return next(error);
    }
  };
}

module.exports = {
  createDraft: handle(
    (req) => provisioningService.createDraft(context(req), req.params.id, req.body),
    201
  ),
  createTagWriterDemo: handle(
    (req) => provisioningService.createTagWriterDemo(
      context(req),
      req.params.id,
      req.body
    ),
    201
  ),
  activate: handle(
    (req) => activationService.activate(
      context(req),
      req.params.bindingId,
      req.body
    )
  ),
  prepare: handle(
    (req) => provisioningService.prepare(
      context(req),
      req.params.bindingId,
      req.body
    )
  ),
  getBinding: handle(
    (req) => lifecycleService.get(context(req), req.params.bindingId)
  ),
  revoke: handle(
    (req) => provisioningService.revoke(
      context(req),
      req.params.bindingId,
      req.body
    )
  ),
  replace: handle(
    (req) => provisioningService.replace(
      context(req),
      req.params.bindingId,
      req.body
    ),
    201
  ),
  cancel: handle(
    (req) => lifecycleService.cancel(
      context(req),
      req.params.bindingId,
      req.body
    )
  ),
  listForChild: handle(
    (req) => lifecycleService.listForChild(context(req), req.params.id)
  ),
  operationsSummary: handle(
    (req) => lifecycleService.operationsSummary(context(req))
  ),
  verifyPublicTap: handle(
    (req) => publicTapService.verifyPublicTap(req.params.publicId, req.body)
  ),
  createChallenge: handle(
    (req) => tapService.createChallenge(
      authenticatedSubjectContext(req),
      req.body
    ),
    201
  ),
  resolveScan: handle(
    (req) => tapService.resolve(authenticatedSubjectContext(req), req.body)
  ),
};
