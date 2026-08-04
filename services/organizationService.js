const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const ROLES = new Set([
  'OWNER',
  'ADMIN',
  'HEALTH_WORKER',
  'NUTRITION_WORKER',
  'EMERGENCY_COORDINATOR',
  'AUDITOR',
]);
const MEMBERSHIP_STATUSES = new Set(['ACTIVE', 'SUSPENDED', 'REVOKED']);
const SCOPE_MODES = new Set(['GLOBAL', 'SCOPED']);

function optionalText(value, field, maxLength = 120) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maxLength);
}

function normalizedCode(value) {
  const code = requiredText(value, 'code', 50).toUpperCase();
  if (!/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/.test(code)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'code may contain letters, numbers, hyphens, and underscores');
  }
  return code;
}

function enumValue(value, field, allowed) {
  if (!allowed.has(value)) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} has an unsupported value`);
  }
  return value;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} must be a valid date and time`);
  }
  return date;
}

function audit(context, action, entityType, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: context.actorSubjectId,
    action,
    entityType,
    entityId,
    purpose: context.purpose,
    ...(metadata ? { metadata } : {}),
  };
}

function createOrganizationService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function listMyOrganizations(subjectId) {
    const normalizedSubjectId = requiredText(subjectId, 'subjectId', 160);
    return database.organizationMembership.findMany({
      where: { subjectId: normalizedSubjectId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        scopeMode: true,
        organization: {
          select: { id: true, name: true, slug: true, status: true },
        },
        facilityScopes: { select: { facilityId: true } },
        programmeScopes: { select: { programmeId: true } },
      },
    });
  }

  async function listMemberships(context) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const records = await transaction.organizationMembership.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          subjectId: true,
          role: true,
          status: true,
          scopeMode: true,
          createdAt: true,
          updatedAt: true,
          facilityScopes: { select: { facilityId: true } },
          programmeScopes: { select: { programmeId: true } },
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'membership.list', 'organization-membership-collection', '*', {
          resultCount: records.length,
        }),
      });
      return records;
    });
  }

  async function upsertMembership(context, input) {
    const subjectId = requiredText(input.subjectId, 'subjectId', 160);
    const role = enumValue(input.role, 'role', ROLES);
    const status = enumValue(input.status || 'ACTIVE', 'status', MEMBERSHIP_STATUSES);
    const scopeMode = enumValue(
      input.scopeMode || 'GLOBAL',
      'scopeMode',
      SCOPE_MODES
    );
    if (role === 'OWNER' && scopeMode !== 'GLOBAL') {
      throw new DomainError(
        400,
        'OWNER_SCOPE_INVALID',
        'Organization owners must have global scope'
      );
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.organizationMembership.findUnique({
        where: { organizationId_subjectId: { organizationId: context.organizationId, subjectId } },
        select: { role: true },
      });
      if ((role === 'OWNER' || existing?.role === 'OWNER') && context.actorRole !== 'OWNER') {
        throw new DomainError(403, 'OWNER_ROLE_REQUIRED', 'Only an owner can grant or modify owner access');
      }
      if (existing?.role === 'OWNER' && (role !== 'OWNER' || status !== 'ACTIVE')) {
        const activeOwnerCount = await transaction.organizationMembership.count({
          where: { organizationId: context.organizationId, role: 'OWNER', status: 'ACTIVE' },
        });
        if (activeOwnerCount <= 1) {
          throw new DomainError(409, 'LAST_OWNER_REQUIRED', 'The organization must retain an active owner');
        }
      }
      const membership = await transaction.organizationMembership.upsert({
        where: { organizationId_subjectId: { organizationId: context.organizationId, subjectId } },
        create: {
          organizationId: context.organizationId,
          subjectId,
          role,
          status,
          scopeMode,
        },
        update: { role, status, scopeMode },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'membership.upserted', 'organization-membership', membership.id, {
          subjectId,
          role,
          status,
          scopeMode,
        }),
      });
      return membership;
    });
  }

  async function createFacility(context, input) {
    const data = {
      organizationId: context.organizationId,
      name: requiredText(input.name, 'name'),
      code: normalizedCode(input.code),
      administrativeArea: optionalText(input.administrativeArea, 'administrativeArea'),
      address: optionalText(input.address, 'address'),
      phone: optionalText(input.phone, 'phone'),
      openingHours: input.openingHours || undefined,
      programmeCategories: input.programmeCategories || undefined,
      latitude: input.latitude === undefined ? undefined : input.latitude,
      longitude: input.longitude === undefined ? undefined : input.longitude,
      isTemporary: input.isTemporary === true,
      temporaryUntil: optionalDate(input.temporaryUntil, 'temporaryUntil'),
    };
    return createResource(context, 'facility', data);
  }

  async function createProgramme(context, input) {
    const startsAt = optionalDate(input.startsAt, 'startsAt');
    const endsAt = optionalDate(input.endsAt, 'endsAt');
    if (startsAt && endsAt && endsAt < startsAt) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'endsAt cannot be before startsAt');
    }
    const data = {
      organizationId: context.organizationId,
      name: requiredText(input.name, 'name'),
      code: normalizedCode(input.code),
      startsAt,
      endsAt,
    };
    return createResource(context, 'programme', data);
  }

  async function createResource(context, resource, data) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const record = await transaction[resource].create({ data });
      await transaction.auditEvent.create({
        data: audit(context, `${resource}.created`, resource, record.id),
      });
      return record;
    });
  }

  async function listResources(context, resource) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const scopedIds = (
        context.scopeMode === 'SCOPED'
        && !['OWNER', 'ADMIN'].includes(context.actorRole)
      )
        ? await transaction[
          resource === 'facility'
            ? 'membershipFacilityScope'
            : 'membershipProgrammeScope'
        ].findMany({
          where: {
            organizationId: context.organizationId,
            membershipId: context.membershipId,
          },
          select: resource === 'facility'
            ? { facilityId: true }
            : { programmeId: true },
        })
        : null;
      const idField = `${resource}Id`;
      const records = await transaction[resource].findMany({
        where: {
          organizationId: context.organizationId,
          isActive: true,
          ...(scopedIds
            ? { id: { in: scopedIds.map((scope) => scope[idField]) } }
            : {}),
        },
        orderBy: { name: 'asc' },
      });
      await transaction.auditEvent.create({
        data: audit(context, `${resource}.list`, `${resource}-collection`, '*', {
          resultCount: records.length,
        }),
      });
      return records;
    });
  }

  return {
    listMyOrganizations,
    listMemberships,
    upsertMembership,
    createFacility,
    listFacilities: (context) => listResources(context, 'facility'),
    createProgramme,
    listProgrammes: (context) => listResources(context, 'programme'),
  };
}

module.exports = { createOrganizationService, normalizedCode };
