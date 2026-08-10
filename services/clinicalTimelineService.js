const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { audit } = require('./clinicalValidation');
const {
  readImmunizationSnapshots,
  snapshotForEvidence,
} = require('./certificateMetadataService');
const {
  withoutImmunizationIntegrityFields,
} = require('./immunizationIntegrity');

function createClinicalTimelineService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function requireActiveChild(transaction, context, childId) {
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
    return child;
  }

  async function get(context, childId) {
    return withTenantTransaction(
      database,
      context.organizationId,
      async (transaction) => {
        await requireActiveChild(transaction, context, childId);
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
        const snapshots = await readImmunizationSnapshots(
          transaction,
          context,
          immunizations.map((record) => record.id)
        );
        await transaction.auditEvent.create({
          data: audit(context, 'clinical-timeline.read', 'child', childId),
        });
        return {
          immunizations: immunizations.map((record) => ({
            ...withoutImmunizationIntegrityFields(record),
            certificateMetadata: snapshotForEvidence(snapshots.get(record.id) || null),
          })),
          growth,
          alerts,
          allergies,
          appointments,
        };
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }

  async function getNutrition(context, childId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await requireActiveChild(transaction, context, childId);
      const growth = await transaction.growthMeasurement.findMany({
        where: { organizationId: context.organizationId, childId },
        orderBy: { measuredAt: 'desc' },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'nutrition-timeline.read', 'child', childId),
      });
      return {
        immunizations: [],
        growth,
        alerts: [],
        allergies: [],
        appointments: [],
      };
    });
  }

  return { get, getNutrition };
}

module.exports = { createClinicalTimelineService };
