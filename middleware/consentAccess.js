const { createConsentService } = require('../services/consentService');

function createConsentAccessMiddleware({ scopes, consentService } = {}) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error('Consent access middleware requires at least one fixed scope');
  }
  const service = consentService || createConsentService();

  return async function consentAccess(req, res, next) {
    try {
      const decision = await service.evaluateDisclosure(
        {
          organizationId: req.organization.id,
          actorSubjectId: req.actorSubjectId,
          role: req.organization.membership.role,
          purpose: req.accessPurpose,
        },
        req.params.id,
        {
          recipientType: 'ORGANIZATION',
          recipientId: req.organization.id,
          purpose: req.accessPurpose,
          scopes,
          requestId: req.requestId,
        }
      );
      req.disclosureDecision = decision;
      if (!decision.allowed) {
        return res.status(403).json({
          success: false,
          code: 'CONSENT_REQUIRED',
          message: 'No active consent permits the requested disclosure',
          disclosureEventId: decision.disclosureEventId,
          requestId: req.requestId,
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createConsentAccessMiddleware };
