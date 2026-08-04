const { createClimateEventService } = require('../services/climateEventService');

const service = createClimateEventService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    role: req.organization.membership.role,
    purpose: req.accessPurpose,
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
  upsertProfile: handle(
    (req) => service.upsertClimateProfile(context(req), req.params.id, req.body)
  ),
  createEvent: handle((req) => service.createEvent(context(req), req.body), 201),
  addAffectedArea: handle(
    (req) => service.addAffectedArea(context(req), req.params.eventId, req.body),
    201
  ),
  transitionEvent: handle(
    (req) => service.transitionEvent(context(req), req.params.eventId, req.body)
  ),
};
