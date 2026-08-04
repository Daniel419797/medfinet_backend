function createCaregiverChildAccessMiddleware({ prismaClient } = {}) {
  return async function caregiverChildAccess(req, res, next) {
    if (req.organization.membership.role !== 'CAREGIVER') return next();

    const database = prismaClient || require('../utils/prisma').prisma;
    try {
      const link = await database.childCaregiver.findFirst({
        where: {
          organizationId: req.organization.id,
          childId: req.params.id,
          caregiver: { subjectId: req.actorSubjectId },
        },
        select: { id: true },
      });
      if (!link) {
        return res.status(403).json({
          success: false,
          code: 'CAREGIVER_CHILD_ACCESS_DENIED',
          message: 'This child is not linked to the authenticated caregiver',
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createCaregiverChildAccessMiddleware };
