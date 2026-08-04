const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

function area(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 120) {
    throw new DomainError(400, 'USSD_AREA_INVALID', 'Administrative area is invalid');
  }
  return normalized;
}

function createUssdFacilityService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function publish(context, facilityId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const facility = await transaction.facility.findFirst({
        where: { id: facilityId, organizationId: context.organizationId, isActive: true },
        include: { organization: { select: { name: true } } },
      });
      if (!facility?.administrativeArea) {
        throw new DomainError(
          409,
          'FACILITY_DIRECTORY_INCOMPLETE',
          'Active facility requires an administrative area before publication'
        );
      }
      const directory = await transaction.ussdFacilityDirectory.upsert({
        where: { facilityId },
        create: {
          organizationId: context.organizationId,
          facilityId,
          organizationName: facility.organization.name,
          facilityName: facility.name,
          administrativeArea: facility.administrativeArea,
          address: facility.address,
          phone: facility.phone,
          openingHours: facility.openingHours,
          programmeCategories: facility.programmeCategories,
          latitude: facility.latitude,
          longitude: facility.longitude,
          isTemporary: facility.isTemporary,
          temporaryUntil: facility.temporaryUntil,
          publishedAt: now(),
        },
        update: {
          organizationName: facility.organization.name,
          facilityName: facility.name,
          administrativeArea: facility.administrativeArea,
          address: facility.address,
          phone: facility.phone,
          openingHours: facility.openingHours,
          programmeCategories: facility.programmeCategories,
          latitude: facility.latitude,
          longitude: facility.longitude,
          isTemporary: facility.isTemporary,
          temporaryUntil: facility.temporaryUntil,
          publishedAt: now(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'ussd.facility-published',
          entityType: 'facility',
          entityId: facilityId,
          purpose: context.purpose,
        },
      });
      return directory;
    });
  }

  async function search(administrativeArea, { temporaryOnly = false } = {}) {
    const currentTime = now();
    return database.ussdFacilityDirectory.findMany({
      where: {
        administrativeArea: { contains: area(administrativeArea), mode: 'insensitive' },
        ...(temporaryOnly ? { isTemporary: true } : {}),
        OR: [{ temporaryUntil: null }, { temporaryUntil: { gt: currentTime } }],
      },
      select: {
        facilityId: true,
        facilityName: true,
        organizationName: true,
        administrativeArea: true,
        address: true,
        phone: true,
        openingHours: true,
        programmeCategories: true,
        isTemporary: true,
      },
      orderBy: [{ isTemporary: 'desc' }, { facilityName: 'asc' }],
      take: 5,
    });
  }

  return { publish, search };
}

module.exports = { createUssdFacilityService };
