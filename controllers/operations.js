const { createOperationsQueryService } = require('../services/operationsQueryService');
const { createUssdCareWorkflowService } = require('../services/ussdCareWorkflowService');
const { createIdentityService, requiredText } = require('../services/identityService');

const service = createOperationsQueryService();
const caregiverWorkflow = createUssdCareWorkflowService();
const identityService = createIdentityService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    role: req.organization.membership.role,
  };
}

function handler(operation) {
  return async (req, res, next) => {
    try {
      const data = await operation(context(req), req);
      return res.json({ success: true, data });
    } catch (error) { return next(error); }
  };
}

module.exports = {
  listCaregivers: handler((ctx, req) => service.listCaregivers(ctx, req.query)),
  listAppointments: handler((ctx, req) => service.listAppointments(ctx, req.query)),
  listEmergencyAccess: handler((ctx, req) => service.listEmergencyAccess(ctx, req.query)),
  listClimateEvents: handler((ctx, req) => service.listClimateEvents(ctx, req.query)),
  listWorklists: handler((ctx, req) => service.listWorklists(ctx, req.query)),
  getWorklist: handler((ctx, req) => service.getWorklist(ctx, req.params.worklistId)),
  listDevices: handler((ctx, req) => service.listDevices(ctx, req.query)),
  listRewardAccounts: handler((ctx, req) => service.listRewardAccounts(ctx, req.query)),
  listRewardRedemptions: handler((ctx, req) => service.listRewardRedemptions(ctx, req.query)),
  respondToAppointment: async (req, res, next) => {
    try {
      const caregiver = await identityService.getMyCaregiverProfile(context(req));
      const idempotencyKey = requiredText(req.body.idempotencyKey, 'idempotencyKey', 160);
      const data = await caregiverWorkflow.respondToAppointment({
        organizationId: req.organization.id,
        actorSubjectId: req.actorSubjectId,
        caregiverId: caregiver.id,
        sessionId: `web:${idempotencyKey}`,
        channel: 'WEB',
        purpose: req.accessPurpose,
      }, req.params.appointmentId, req.body);
      return res.status(201).json({ success: true, data });
    } catch (error) { return next(error); }
  },
};
