const {
  createVaccineScheduleService,
} = require('../services/vaccineScheduleService');

const service = createVaccineScheduleService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    role: req.organization.membership.role,
    membershipId: req.organization.membership.id,
    scopeMode: req.organization.membership.scopeMode,
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
  listRules: handle((req) => service.listRules(context(req), req.query)),
  createRule: handle(
    (req) => service.createRule(context(req), req.body),
    201
  ),
  activateRule: handle(
    (req) => service.activateRule(context(req), req.params.ruleId)
  ),
  evaluate: handle(
    (req) => service.evaluate(context(req), req.params.id, req.query)
  ),
};
