const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { DomainError } = require('../utils/domainError');
const {
  enrichFacilities,
  saveFacilityProfile,
} = require('./certificateMetadataService');

function optionalText(value, field, maximum = 160) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return requiredText(value, field, maximum);
}

function createOrganizationResourceLifecycleService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function updateFacility(context, facilityId, input) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.facility.findFirst({
        where: { id: facilityId, organizationId: context.organizationId },
      });
      if (!existing) {
        throw new DomainError(404, 'FACILITY_NOT_FOUND', 'Facility not found');
      }
      if (input.isActive === false && existing.isActive) {
        const scheduled = await transaction.appointment.count({
          where: {
            organizationId: context.organizationId,
            facilityId,
            status: 'SCHEDULED',
            scheduledFor: { gte: new Date() },
          },
        });
        if (scheduled > 0) {
          throw new DomainError(
            409,
            'FACILITY_HAS_SCHEDULED_APPOINTMENTS',
            'Reassign or cancel scheduled appointments before archiving'
          );
        }
      }
      const profileTouched = [input.state, input.lga, input.ward]
        .some((value) => value !== undefined);
      const data = {
        ...(input.name !== undefined
          ? { name: requiredText(input.name, 'name', 160) }
          : {}),
        ...(input.administrativeArea !== undefined
          ? {
            administrativeArea: optionalText(
              input.administrativeArea,
              'administrativeArea'
            ),
          }
          : input.state !== undefined
            ? { administrativeArea: optionalText(input.state, 'state') }
            : {}),
        ...(typeof input.isActive === 'boolean'
          ? { isActive: input.isActive }
          : {}),
        ...(input.address !== undefined ? { address: optionalText(input.address, 'address') } : {}),
        ...(input.phone !== undefined ? { phone: optionalText(input.phone, 'phone') } : {}),
        ...(input.openingHours !== undefined ? { openingHours: input.openingHours } : {}),
        ...(input.programmeCategories !== undefined
          ? { programmeCategories: input.programmeCategories }
          : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(typeof input.isTemporary === 'boolean' ? { isTemporary: input.isTemporary } : {}),
        ...(input.temporaryUntil !== undefined
          ? { temporaryUntil: input.temporaryUntil ? new Date(input.temporaryUntil) : null }
          : {}),
      };
      if (Object.keys(data).length === 0 && !profileTouched) {
        throw new DomainError(400, 'VALIDATION_ERROR', 'No facility changes provided');
      }
      const facility = Object.keys(data).length
        ? await transaction.facility.update({
          where: { id: existing.id },
          data,
        })
        : existing;
      if (profileTouched) {
        await saveFacilityProfile(transaction, context, facility.id, {
          state: input.state,
          lga: input.lga,
          ward: input.ward,
        });
      }
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'facility.updated',
          entityType: 'facility',
          entityId: facility.id,
          purpose: context.purpose,
          metadata: {
            changedFields: [
              ...Object.keys(data),
              ...(profileTouched ? ['state', 'lga', 'ward'] : []),
            ],
            isActive: facility.isActive,
          },
        },
      });
      return (await enrichFacilities(transaction, context, [facility]))[0];
    });
  }

  async function updateProgramme(context, programmeId, input) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.programme.findFirst({
        where: { id: programmeId, organizationId: context.organizationId },
      });
      if (!existing) {
        throw new DomainError(404, 'PROGRAMME_NOT_FOUND', 'Programme not found');
      }
      if (input.isActive === false && existing.isActive) {
        const [worklists, campaigns] = await Promise.all([
          transaction.beneficiaryWorklist.count({
            where: {
              organizationId: context.organizationId,
              programmeId,
              status: { in: ['DRAFT', 'AUTHORIZED', 'ACTIVE'] },
            },
          }),
          transaction.rewardCampaign.count({
            where: {
              organizationId: context.organizationId,
              programmeId,
              status: { in: ['DRAFT', 'ACTIVE', 'PAUSED'] },
            },
          }),
        ]);
        if (worklists + campaigns > 0) {
          throw new DomainError(
            409,
            'PROGRAMME_HAS_ACTIVE_WORK',
            'Close active worklists and reward campaigns before archiving'
          );
        }
      }
      const startsAt = input.startsAt === undefined
        ? existing.startsAt
        : input.startsAt === null
          ? null
          : new Date(input.startsAt);
      const endsAt = input.endsAt === undefined
        ? existing.endsAt
        : input.endsAt === null
          ? null
          : new Date(input.endsAt);
      if (
        (startsAt && Number.isNaN(startsAt.valueOf()))
        || (endsAt && Number.isNaN(endsAt.valueOf()))
        || (startsAt && endsAt && endsAt < startsAt)
      ) {
        throw new DomainError(
          400,
          'VALIDATION_ERROR',
          'Programme dates must be valid and chronological'
        );
      }
      const data = {
        ...(input.name !== undefined
          ? { name: requiredText(input.name, 'name', 160) }
          : {}),
        ...(input.startsAt !== undefined ? { startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt } : {}),
        ...(typeof input.isActive === 'boolean'
          ? { isActive: input.isActive }
          : {}),
      };
      if (Object.keys(data).length === 0) {
        throw new DomainError(400, 'VALIDATION_ERROR', 'No programme changes provided');
      }
      const programme = await transaction.programme.update({
        where: { id: existing.id },
        data,
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'programme.updated',
          entityType: 'programme',
          entityId: programme.id,
          purpose: context.purpose,
          metadata: {
            changedFields: Object.keys(data),
            isActive: programme.isActive,
          },
        },
      });
      return programme;
    });
  }

  return { updateFacility, updateProgramme };
}

module.exports = { createOrganizationResourceLifecycleService };
