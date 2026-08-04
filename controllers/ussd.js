const { createUssdAdminService } = require('../services/ussdAdminService');

const service = createUssdAdminService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    purpose: req.accessPurpose,
  };
}

async function configureAccess(req, res, next) {
  try {
    const result = await service.configureAccess(context(req), req.params.caregiverId, req.body);
    return res.json({ success: true, data: result });
  } catch (error) { return next(error); }
}

async function publishFacility(req, res, next) {
  try {
    const result = await service.publishFacility(context(req), req.params.facilityId);
    return res.json({ success: true, data: result });
  } catch (error) { return next(error); }
}

async function createConsentRequest(req, res, next) {
  try {
    const result = await service.createConsentRequest(context(req), req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (error) { return next(error); }
}

async function listQueue(req, res, next) {
  try {
    const result = await service.listQueue(context(req), req.params.type, req.query.status);
    return res.json({ success: true, data: result });
  } catch (error) { return next(error); }
}

async function reviewQueueItem(req, res, next) {
  try {
    const result = await service.reviewQueueItem(
      context(req),
      req.params.type,
      req.params.id,
      req.body
    );
    return res.json({ success: true, data: result });
  } catch (error) { return next(error); }
}

module.exports = {
  configureAccess,
  createConsentRequest,
  listQueue,
  publishFacility,
  reviewQueueItem,
};
