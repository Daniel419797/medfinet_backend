const {
  createAnalyticsPolicyService,
} = require('../services/analyticsPolicyService');
const {
  createAnalyticsGenerationService,
} = require('../services/analyticsGenerationService');
const {
  createAnalyticsQueryService,
} = require('../services/analyticsQueryService');
const { createNarrativeService } = require('../services/ai/narrativeService');

const policyService = createAnalyticsPolicyService();
const generationService = createAnalyticsGenerationService();
const queryService = createAnalyticsQueryService();
const narrativeService = createNarrativeService({ query: queryService });

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
  getPolicy: handle((req) => policyService.get(context(req))),
  updatePolicy: handle((req) => policyService.upsert(context(req), req.body)),
  requestGeneration: handle(
    (req) => generationService.request(context(req), req.body),
    202
  ),
  latestInternal: handle((req) => queryService.latestInternal(context(req))),
  narrative: handle((req) => narrativeService.generate(context(req))),
  publicMetrics: handle(
    (req) => queryService.publicMetrics(req.params.organizationSlug)
  ),
};
