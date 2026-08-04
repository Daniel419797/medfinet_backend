const { createAssistantService } = require('../services/ai/assistantService');
const { createUssdIntakeService } = require('../services/ai/ussdIntakeService');
const { createDuplicateDetectionService } = require('../services/ai/duplicateDetectionService');
const { createRewardAnomalyService } = require('../services/ai/rewardAnomalyService');
const { createTimelineSummaryService } = require('../services/ai/timelineSummaryService');
const { createMappingAssistService } = require('../services/ai/mappingAssistService');
const { createLocalizationAssistService } = require('../services/ai/localizationAssistService');

const assistantService = createAssistantService();
const ussdIntakeService = createUssdIntakeService();
const duplicateDetectionService = createDuplicateDetectionService();
const rewardAnomalyService = createRewardAnomalyService();
const timelineSummaryService = createTimelineSummaryService();
const mappingAssistService = createMappingAssistService();
const localizationAssistService = createLocalizationAssistService();

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
  askAssistant: handle((req) => assistantService.ask(context(req), {
    childId: req.params.id,
    question: req.body.question,
    locale: req.body.locale,
  })),
  parseUssdIntake: handle((req) => ussdIntakeService.parse(context(req), {
    text: req.body.text,
    locale: req.body.locale,
  })),
  detectDuplicates: handle((req) => duplicateDetectionService.detect(context(req), {
    childId: req.params.id,
    limit: req.query.limit,
  })),
  detectRewardAnomalies: handle((req) => rewardAnomalyService.detect(context(req), {
    limit: req.query.limit,
  })),
  summarizeTimeline: handle((req) => timelineSummaryService.summarize(context(req), {
    childId: req.params.id,
    locale: req.body.locale,
  })),
  suggestMapping: handle((req) => mappingAssistService.suggest({
    connectionType: req.body.connectionType,
    resourceType: req.body.resourceType,
    sourceFields: req.body.sourceFields,
    targetFields: req.body.targetFields,
  })),
  generateTranslation: handle((req) => localizationAssistService.generate(context(req), {
    contentKey: req.body.contentKey,
    value: req.body.value,
    sourceLocale: req.body.sourceLocale,
    targetLocale: req.body.targetLocale,
  }), 201),
};