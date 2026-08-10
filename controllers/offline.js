const { createDeviceService } = require('../services/deviceService');
const { createSyncService } = require('../services/syncService');

const deviceService = createDeviceService();
const syncService = createSyncService();

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
  registerDevice: handle((req) => deviceService.register(context(req), req.body), 201),
  revokeDevice: handle(
    (req) => deviceService.revoke(context(req), req.params.deviceId, req.body)
  ),
  setNfcProvisioningCapability: handle(
    (req) => deviceService.setNfcProvisioningCapability(
      context(req),
      req.params.deviceId,
      req.body.enabled
    )
  ),
  submitBatch: handle(
    (req) => syncService.submitBatch(
      context(req),
      req.params.deviceId,
      req.body
    ),
    202
  ),
  getBatch: handle(
    (req) => syncService.getBatch(context(req), req.params.batchId)
  ),
  listBatches: handle(
    (req) => syncService.listBatches(context(req), req.query)
  ),
};
