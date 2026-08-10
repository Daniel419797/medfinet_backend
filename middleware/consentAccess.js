const { createConsentService } = require('../services/consentService');

const ADMIN_TEST_BYPASS_ROLES = new Set(['OWNER', 'ADMIN']);

function adminTestBypassEnabled() {
  return String(process.env.admin || '').trim().toLowerCase() === 'test';
}

function canUseAdminTestBypass(req, scopes) {
  if (!adminTestBypassEnabled()) return false;
  const role = req.organization?.membership?.role;
  if (!ADMIN_TEST_BYPASS_ROLES.has(role)) return false;
  return scopes.every((scope) => scope?.access === 'READ');
}

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
        if (canUseAdminTestBypass(req, scopes)) {
          req.consentBypass = {
            type: 'ADMIN_TEST',
            originalReasonCode: decision.reasonCode,
            disclosureEventId: decision.disclosureEventId,
          };
          req.disclosureDecision = {
            ...decision,
            allowed: true,
            reasonCode: 'ADMIN_TEST_BYPASS',
          };
          return next();
        }
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

module.exports = {
  createConsentAccessMiddleware,
  adminTestBypassEnabled,
  canUseAdminTestBypass,
};
