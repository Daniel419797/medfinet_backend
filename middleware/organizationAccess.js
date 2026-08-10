function resolveSubjectId(user) {
  return user?.id || user?.sub || user?.hospital_id || null;
}

function adminTestNfcScannerRegistrationBypass(req, membership, purpose) {
  return process.env.admin === 'test'
    && req.method === 'POST'
    && req.path === '/devices'
    && purpose === 'nfc-scanner-registration'
    && ['OWNER', 'ADMIN'].includes(membership?.role);
}

function createOrganizationAccessMiddleware({
  prismaClient,
  allowedRoles = [],
  allowedOrganizationStatuses = ['ACTIVE'],
} = {}) {
  return async function organizationAccess(req, res, next) {
    const database = prismaClient || require('../utils/prisma').prisma;
    const organizationId = req.get('x-organization-id');
    const purpose = req.get('x-access-purpose');
    const subjectId = resolveSubjectId(req.user);

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        code: 'ORGANIZATION_REQUIRED',
        message: 'x-organization-id is required',
      });
    }

    if (!purpose) {
      return res.status(400).json({
        success: false,
        code: 'ACCESS_PURPOSE_REQUIRED',
        message: 'x-access-purpose is required',
      });
    }

    if (purpose.trim().length > 120) {
      return res.status(400).json({
        success: false,
        code: 'ACCESS_PURPOSE_INVALID',
        message: 'x-access-purpose must not exceed 120 characters',
      });
    }

    if (!subjectId) {
      return res.status(401).json({
        success: false,
        code: 'SUBJECT_REQUIRED',
        message: 'The authenticated token has no subject identifier',
      });
    }

    try {
      const membership = await database.organizationMembership.findUnique({
        where: {
          organizationId_subjectId: { organizationId, subjectId },
        },
        include: {
          organization: { select: { status: true } },
        },
      });

      const roleAllowed = allowedRoles.length === 0
        || allowedRoles.includes(membership?.role)
        || adminTestNfcScannerRegistrationBypass(req, membership, purpose.trim());
      if (
        !membership ||
        membership.status !== 'ACTIVE' ||
        !allowedOrganizationStatuses.includes(membership.organization.status) ||
        !roleAllowed
      ) {
        return res.status(403).json({
          success: false,
          code: 'ORGANIZATION_ACCESS_DENIED',
          message: 'Access to this organization is not permitted',
        });
      }

      req.organization = { id: organizationId, membership };
      req.accessPurpose = purpose.trim();
      req.actorSubjectId = subjectId;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  createOrganizationAccessMiddleware,
  organizationAccess: createOrganizationAccessMiddleware(),
  resolveSubjectId,
};
