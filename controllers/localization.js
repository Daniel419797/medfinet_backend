const {
  createLocalizationService,
} = require('../services/localizationService');

const service = createLocalizationService();

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
  supported: handle(() => service.supported()),
  catalog: handle(
    (req) => service.catalog(context(req), req.params.locale)
  ),
  listContent: handle(
    (req) => service.listContent(context(req), req.query)
  ),
  createDraft: handle(
    (req) => service.createDraft(context(req), req.body),
    201
  ),
  activate: handle(
    (req) => service.activate(context(req), req.params.contentId)
  ),
};
