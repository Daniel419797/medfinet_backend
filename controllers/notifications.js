const {
  createNotificationTemplateService,
} = require('../services/notificationTemplateService');
const {
  createNotificationPreferenceService,
} = require('../services/notificationPreferenceService');
const {
  createNotificationInboxService,
} = require('../services/notificationInboxService');

const templateService = createNotificationTemplateService();
const preferenceService = createNotificationPreferenceService();
const inboxService = createNotificationInboxService();

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
  createTemplate: handle(
    (req) => templateService.createTemplate(context(req), req.body),
    201
  ),
  activateTemplate: handle(
    (req) => templateService.activateTemplate(context(req), req.params.templateId)
  ),
  listTemplates: handle(
    (req) => templateService.listTemplates(context(req), req.query)
  ),
  upsertPreference: handle(
    (req) => preferenceService.upsert(context(req), req.body)
  ),
  listPreferences: handle(
    (req) => preferenceService.list(
      context(req),
      req.query.subjectId || req.actorSubjectId
    )
  ),
  listInbox: handle(
    (req) => inboxService.list(context(req), req.query)
  ),
  markRead: handle(
    (req) => inboxService.markRead(context(req), req.params.messageId)
  ),
};
