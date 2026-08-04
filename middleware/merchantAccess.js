const { resolveSubjectId } = require('./organizationAccess');

function createMerchantAccessMiddleware({ prismaClient, allowedRoles = [] } = {}) {
  return async function merchantAccess(req, res, next) {
    const database = prismaClient || require('../utils/prisma').prisma;
    const organizationId = req.organization?.id;
    const merchantId = req.params.merchantId;
    const subjectId = resolveSubjectId(req.user);

    if (!organizationId || !merchantId || !subjectId) {
      return res.status(403).json({
        success: false,
        code: 'MERCHANT_ACCESS_DENIED',
        message: 'Merchant access is not permitted',
      });
    }

    try {
      const membership = await database.merchantMembership.findFirst({
        where: {
          organizationId,
          merchantId,
          subjectId,
          status: 'ACTIVE',
          ...(allowedRoles.length ? { role: { in: allowedRoles } } : {}),
          merchant: { status: 'ACTIVE' },
        },
      });
      if (!membership) {
        return res.status(403).json({
          success: false,
          code: 'MERCHANT_ACCESS_DENIED',
          message: 'Merchant access is not permitted',
        });
      }
      req.merchant = { id: merchantId, membership };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createMerchantAccessMiddleware };
