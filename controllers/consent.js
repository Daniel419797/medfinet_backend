const { createConsentService } = require('../services/consentService');

const service = createConsentService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    role: req.organization.membership.role,
    purpose: req.accessPurpose,
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
      return next(error);
    }
  };
}

module.exports = {
  grant: handle(
    (req) => service.grantConsent(context(req), req.params.id, req.body),
    201
  ),
  authorities: handle(
    (req) => service.listConsentAuthorities(context(req), req.params.id)
  ),
  list: handle((req) => service.listConsents(context(req), req.params.id, {
    includeInactive: req.query.includeInactive === 'true',
  })),
  withdraw: handle(
    (req) => service.withdrawConsent(context(req), req.params.consentId, req.body)
  ),
  evaluate: handle(
    (req) => service.evaluateDisclosure(context(req), req.params.id, req.body)
  ),
};
