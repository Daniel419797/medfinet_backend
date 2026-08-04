const { createEmergencyAccessService } = require('../services/emergencyAccessService');

const service = createEmergencyAccessService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    role: req.organization.membership.role,
    purpose: req.accessPurpose,
    authenticatedAt: req.authenticatedAt,
    requestId: req.requestId,
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
  activate: handle(
    (req) => service.activate(context(req), req.params.id, req.body),
    201
  ),
  profile: handle(
    (req) => service.getEmergencyProfile(
      context(req),
      req.params.id,
      req.get('x-emergency-access-id')
    )
  ),
  review: handle(
    (req) => service.review(context(req), req.params.accessId, req.body)
  ),
};
