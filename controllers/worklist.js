const { createWorklistService } = require('../services/worklistService');
const { createReferralService } = require('../services/referralService');
const {
  createWorklistGenerationService,
} = require('../services/worklistGenerationService');

const worklistService = createWorklistService();
const referralService = createReferralService();
const generationService = createWorklistGenerationService();

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
  create: handle(
    (req) => worklistService.createWorklist(
      context(req),
      req.params.eventId,
      req.body
    ),
    201
  ),
  generate: handle(
    (req) => generationService.requestGeneration(context(req), req.params.worklistId),
    202
  ),
  authorize: handle(
    (req) => worklistService.authorizeWorklist(context(req), req.params.worklistId)
  ),
  deliver: handle(
    (req) => worklistService.recordDelivery(context(req), req.params.entryId, req.body),
    201
  ),
  createReferral: handle(
    (req) => referralService.createReferral(context(req), req.params.entryId, req.body),
    201
  ),
  transitionReferral: handle(
    (req) => referralService.transitionReferral(
      context(req),
      req.params.referralId,
      req.body
    )
  ),
};
