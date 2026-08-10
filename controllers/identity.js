const { DomainError } = require('../utils/domainError');
const { createIdentityService } = require('../services/identityService');
const { resolveSubjectId } = require('../middleware/organizationAccess');
const {
  createChildIdentityAmendmentService,
} = require('../services/childIdentityAmendmentService');
const {
  createChildIdentifierService,
} = require('../services/childIdentifierService');
const {
  createCaregiverPortalService,
} = require('../services/caregiverPortalService');
const {
  createIdentityProviderAdminService,
} = require('../services/identityProviderAdminService');

const identityService = createIdentityService();
const amendmentService = createChildIdentityAmendmentService();
const identifierService = createChildIdentifierService();
const caregiverPortalService = createCaregiverPortalService();
let identityProviderAdminService;

function accountResolver() {
  identityProviderAdminService ||= createIdentityProviderAdminService();
  return identityProviderAdminService;
}

function contextFromRequest(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    role: req.organization.membership.role,
    purpose: req.accessPurpose,
  };
}

function sendError(next, error) {
  if (error.name === 'DomainError') return next(error);
  return next(error);
}

async function createOrganization(req, res, next) {
  try {
    const organization = await identityService.createOrganization({
      actorSubjectId: resolveSubjectId(req.user),
      name: req.body.name,
      slug: req.body.slug,
    });
    return res.status(201).json({ success: true, data: organization });
  } catch (error) {
    return sendError(next, error);
  }
}

async function createChild(req, res, next) {
  try {
    const child = await identityService.createChild(contextFromRequest(req), req.body);
    return res.status(201).json({ success: true, data: child });
  } catch (error) {
    return sendError(next, error);
  }
}

async function listChildren(req, res, next) {
  try {
    const result = await identityService.listChildren(contextFromRequest(req), req.query);
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendError(next, error);
  }
}

async function searchChildren(req, res, next) {
  try {
    const children = await identityService.searchChildren(contextFromRequest(req), req.query);
    return res.json({ success: true, data: children });
  } catch (error) {
    return sendError(next, error);
  }
}

async function getChild(req, res, next) {
  try {
    const child = await identityService.getChild(contextFromRequest(req), req.params.id);
    return res.json({ success: true, data: child });
  } catch (error) {
    return sendError(next, error);
  }
}

async function getMyCaregiverProfile(req, res, next) {
  try {
    const caregiver = await identityService.getMyCaregiverProfile(contextFromRequest(req));
    return res.json({ success: true, data: caregiver });
  } catch (error) {
    return sendError(next, error);
  }
}

async function createCaregiver(req, res, next) {
  try {
    if (req.body.subjectId) {
      throw new DomainError(
        400,
        'VERIFIED_PARENT_CONNECTION_REQUIRED',
        'Portal access cannot be attached through caregiver registration. Use the verified Connect parent account workflow instead.'
      );
    }
    const caregiver = await identityService.createCaregiver(contextFromRequest(req), req.body);
    return res.status(201).json({ success: true, data: caregiver });
  } catch (error) {
    return sendError(next, error);
  }
}

async function connectParent(req, res, next) {
  try {
    const account = await accountResolver().resolveVerifiedAccount({
      accountId: req.body.accountId,
      email: req.body.accountEmail,
    });
    const result = await caregiverPortalService.connectParent(
      contextFromRequest(req),
      req.body,
      account
    );
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return sendError(next, error);
  }
}

async function linkCaregiver(req, res, next) {
  try {
    const link = await identityService.linkCaregiver(contextFromRequest(req), req.params.id, req.body);
    return res.status(201).json({ success: true, data: link });
  } catch (error) {
    return sendError(next, error);
  }
}

async function requestIdentityAmendment(req, res, next) {
  try {
    const amendment = await amendmentService.request(
      contextFromRequest(req),
      req.params.id,
      req.body
    );
    return res.status(201).json({ success: true, data: amendment });
  } catch (error) {
    return sendError(next, error);
  }
}

async function reviewIdentityAmendment(req, res, next) {
  try {
    const amendment = await amendmentService.review(
      contextFromRequest(req),
      req.params.amendmentId,
      req.body
    );
    return res.json({ success: true, data: amendment });
  } catch (error) {
    return sendError(next, error);
  }
}

async function listIdentityAmendments(req, res, next) {
  try {
    const amendments = await amendmentService.list(
      contextFromRequest(req),
      req.params.id
    );
    return res.json({ success: true, data: amendments });
  } catch (error) {
    return sendError(next, error);
  }
}

async function createChildIdentifier(req, res, next) {
  try {
    const identifier = await identifierService.create(
      contextFromRequest(req),
      req.params.id,
      req.body
    );
    return res.status(201).json({ success: true, data: identifier });
  } catch (error) {
    return sendError(next, error);
  }
}

async function verifyChildIdentifier(req, res, next) {
  try {
    const identifier = await identifierService.verify(
      contextFromRequest(req),
      req.params.identifierId
    );
    return res.json({ success: true, data: identifier });
  } catch (error) {
    return sendError(next, error);
  }
}

async function revokeChildIdentifier(req, res, next) {
  try {
    const identifier = await identifierService.revoke(
      contextFromRequest(req),
      req.params.identifierId,
      req.body
    );
    return res.json({ success: true, data: identifier });
  } catch (error) {
    return sendError(next, error);
  }
}

async function listChildIdentifiers(req, res, next) {
  try {
    const identifiers = await identifierService.list(
      contextFromRequest(req),
      req.params.id
    );
    return res.json({ success: true, data: identifiers });
  } catch (error) {
    return sendError(next, error);
  }
}

module.exports = {
  createOrganization,
  createChild,
  searchChildren,
  listChildren,
  getChild,
  getMyCaregiverProfile,
  createCaregiver,
  connectParent,
  linkCaregiver,
  requestIdentityAmendment,
  reviewIdentityAmendment,
  listIdentityAmendments,
  createChildIdentifier,
  verifyChildIdentifier,
  revokeChildIdentifier,
  listChildIdentifiers,
};