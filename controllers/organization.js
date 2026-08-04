const { createOrganizationService } = require('../services/organizationService');
const {
  createOrganizationLifecycleService,
} = require('../services/organizationLifecycleService');
const {
  createOrganizationResourceLifecycleService,
} = require('../services/organizationResourceLifecycleService');
const {
  createResourceScopeService,
} = require('../services/resourceScopeService');

const organizationService = createOrganizationService();
const lifecycleService = createOrganizationLifecycleService();
const resourceLifecycleService = createOrganizationResourceLifecycleService();
const resourceScopeService = createResourceScopeService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    actorRole: req.organization.membership.role,
    role: req.organization.membership.role,
    membershipId: req.organization.membership.id,
    scopeMode: req.organization.membership.scopeMode,
    purpose: req.accessPurpose,
  };
}

function handler(operation, status = 200) {
  return async function organizationHandler(req, res, next) {
    try {
      const data = await operation(context(req), req.body, req);
      return res.status(status).json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  listMyOrganizations: async (req, res, next) => {
    try {
      const subjectId = req.user?.id || req.user?.sub;
      const data = await organizationService.listMyOrganizations(subjectId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
  listMemberships: handler((ctx) => organizationService.listMemberships(ctx)),
  upsertMembership: handler((ctx, body) => organizationService.upsertMembership(ctx, body), 201),
  listFacilities: handler((ctx) => organizationService.listFacilities(ctx)),
  createFacility: handler((ctx, body) => organizationService.createFacility(ctx, body), 201),
  listProgrammes: handler((ctx) => organizationService.listProgrammes(ctx)),
  createProgramme: handler((ctx, body) => organizationService.createProgramme(ctx, body), 201),
  changeOrganizationStatus: handler(
    (ctx, body) => lifecycleService.changeStatus(ctx, body)
  ),
  updateFacility: handler(
    (ctx, body, req) => resourceLifecycleService.updateFacility(
      ctx,
      req.params.facilityId,
      body
    )
  ),
  updateProgramme: handler(
    (ctx, body, req) => resourceLifecycleService.updateProgramme(
      ctx,
      req.params.programmeId,
      body
    )
  ),
  replaceMembershipScopes: handler(
    (ctx, body, req) => resourceScopeService.replace(
      ctx,
      req.params.membershipId,
      body
    )
  ),
};
