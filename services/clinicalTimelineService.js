const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { audit } = require('./clinicalValidation');

function createClinicalTimelineService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function get(context, childId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await transaction.child.findFirst({
        where: {
          id: childId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!child) {
        throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
      }
      const [
        immunizations,
        growth,
        alerts,
        allergies,
        appointments,
      ] = await Promise.all([
        transaction.immunizationRecord.findMany({
          where: { organizationId: context.organizationId, childId },
          orderBy: { administeredAt: 'desc' },
        }),
        transaction.growthMeasurement.findMany({
          where: { organizationId: context.organizationId, childId },
          orderBy: { measuredAt: 'desc' },
        }),
        transaction.clinicalAlert.findMany({
          where: { organizationId: context.organizationId, childId },
          orderBy: { createdAt: 'desc' },
        }),
        transaction.allergyRecord.findMany({
          where: { organizationId: context.organizationId, childId },
          orderBy: { createdAt: 'desc' },
        }),
        transaction.appointment.findMany({
          where: { organizationId: context.organizationId, childId },
          orderBy: { scheduledFor: 'asc' },
        }),
      ]);
      await transaction.auditEvent.create({
        data: audit(context, 'clinical-timeline.read', 'child', childId),
      });
      return { immunizations, growth, alerts, allergies, appointments };
    });
  }

  return { get };
}

module.exports = { createClinicalTimelineService };
