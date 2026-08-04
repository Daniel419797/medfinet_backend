const {
  createRetentionPolicyService,
} = require('../services/retentionPolicyService');
const {
  createRetentionExecutionService,
} = require('../services/retentionExecutionService');
const {
  createLegalHoldService,
} = require('../services/legalHoldService');
const {
  createDataSubjectRequestService,
} = require('../services/dataSubjectRequestService');
const {
  createAuditQueryService,
} = require('../services/auditQueryService');

const retentionPolicyService = createRetentionPolicyService();
const retentionExecutionService = createRetentionExecutionService();
const legalHoldService = createLegalHoldService();
const subjectRequestService = createDataSubjectRequestService();
const auditQueryService = createAuditQueryService();

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
  listAuditEvents: handle(
    (req) => auditQueryService.list(context(req), req.query)
  ),
  listRetentionPolicies: handle(
    (req) => retentionPolicyService.list(context(req))
  ),
  createRetentionPolicy: handle(
    (req) => retentionPolicyService.create(context(req), req.body),
    201
  ),
  activateRetentionPolicy: handle(
    (req) => retentionPolicyService.activate(
      context(req),
      req.params.policyId
    )
  ),
  previewRetention: handle(
    (req) => retentionExecutionService.preview(
      context(req),
      req.params.policyId,
      req.body
    ),
    201
  ),
  approveRetention: handle(
    (req) => retentionExecutionService.approve(
      context(req),
      req.params.runId
    )
  ),
  executeRetention: handle(
    (req) => retentionExecutionService.execute(
      context(req),
      req.params.runId
    )
  ),
  listLegalHolds: handle(
    (req) => legalHoldService.list(context(req), req.query)
  ),
  placeLegalHold: handle(
    (req) => legalHoldService.place(context(req), req.body),
    201
  ),
  releaseLegalHold: handle(
    (req) => legalHoldService.release(
      context(req),
      req.params.holdId,
      req.body
    )
  ),
  listSubjectRequests: handle(
    (req) => subjectRequestService.list(context(req), req.query)
  ),
  submitSubjectRequest: handle(
    (req) => subjectRequestService.submit(context(req), req.body),
    201
  ),
  verifySubjectRequest: handle(
    (req) => subjectRequestService.verifyIdentity(
      context(req),
      req.params.requestId
    )
  ),
  decideSubjectRequest: handle(
    (req) => subjectRequestService.decide(
      context(req),
      req.params.requestId,
      req.body
    )
  ),
  completeSubjectRequest: handle(
    (req) => subjectRequestService.complete(
      context(req),
      req.params.requestId
    )
  ),
};
