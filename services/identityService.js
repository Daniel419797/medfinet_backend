const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const {
  defaultNotificationTemplates,
} = require('./notificationDefaults');

const CHILD_SEXES = new Set(['FEMALE', 'MALE', 'INTERSEX', 'UNKNOWN']);
const CAREGIVER_RELATIONSHIPS = new Set(['MOTHER', 'FATHER', 'GUARDIAN', 'RELATIVE', 'OTHER']);

function requiredText(value, field, maxLength = 120) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} is too long`);
  }
  return normalized;
}

function optionalText(value, field, maxLength = 80) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maxLength);
}

function parseDateOfBirth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'dateOfBirth must use YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'dateOfBirth is not a valid date');
  }
  if (date > new Date()) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'dateOfBirth cannot be in the future');
  }
  return date;
}

function assertEnum(value, field, allowedValues) {
  if (!allowedValues.has(value)) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} has an unsupported value`);
  }
  return value;
}

function createIdentityService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  function childAccessWhere(context) {
    if (context.role !== 'CAREGIVER') return {};
    return {
      caregivers: {
        some: { caregiver: { subjectId: context.actorSubjectId } },
      },
    };
  }

  async function createOrganization({ actorSubjectId, name, slug }) {
    if (!actorSubjectId) throw new DomainError(401, 'SUBJECT_REQUIRED', 'An authenticated subject is required');
    const organizationName = requiredText(name, 'name');
    const organizationSlug = requiredText(slug, 'slug', 80).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'slug must contain lowercase letters, numbers, and hyphens');
    }

    return database.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({
        data: { name: organizationName, slug: organizationSlug },
      });
      await transaction.organizationMembership.create({
        data: { organizationId: organization.id, subjectId: actorSubjectId, role: 'OWNER' },
      });
      await transaction.$executeRawUnsafe(
        "SELECT set_config('app.current_organization_id', $1, true)",
        organization.id
      );
      await transaction.notificationTemplate.createMany({
        data: defaultNotificationTemplates(
          organization.id,
          actorSubjectId,
          new Date()
        ),
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: organization.id,
          actorSubjectId,
          action: 'organization.created',
          entityType: 'organization',
          entityId: organization.id,
          purpose: 'organization-administration',
        },
      });
      return organization;
    });
  }

  async function createChild(context, input) {
    const data = {
      organizationId: context.organizationId,
      medfinetId: `MED-${crypto.randomUUID()}`,
      firstName: requiredText(input.firstName, 'firstName'),
      lastName: requiredText(input.lastName, 'lastName'),
      dateOfBirth: parseDateOfBirth(input.dateOfBirth),
      sex: assertEnum(input.sex, 'sex', CHILD_SEXES),
      createdBySubjectId: context.actorSubjectId,
    };

    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const possibleDuplicates = await transaction.child.findMany({
        where: {
          organizationId: context.organizationId,
          firstName: { equals: data.firstName, mode: 'insensitive' },
          lastName: { equals: data.lastName, mode: 'insensitive' },
          dateOfBirth: data.dateOfBirth,
          status: { not: 'DUPLICATE' },
        },
        select: { id: true, medfinetId: true },
        take: 10,
      });
      const confirmedDistinct = new Set(
        Array.isArray(input.confirmedDistinctFromIds) ? input.confirmedDistinctFromIds : []
      );
      const unconfirmed = possibleDuplicates.filter(({ id }) => !confirmedDistinct.has(id));
      if (unconfirmed.length) {
        throw new DomainError(
          409,
          'POSSIBLE_DUPLICATE',
          'A possible duplicate child exists; review it before creating another record',
          { candidates: unconfirmed }
        );
      }
      const child = await transaction.child.create({ data });
      await transaction.auditEvent.create({
        data: auditData(context, 'child.created', 'child', child.id),
      });
      return child;
    });
  }

  async function searchChildren(context, input) {
    const firstName = requiredText(input.firstName, 'firstName');
    const lastName = requiredText(input.lastName, 'lastName');
    const dateOfBirth = parseDateOfBirth(input.dateOfBirth);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const children = await transaction.child.findMany({
        where: {
          organizationId: context.organizationId,
          firstName: { equals: firstName, mode: 'insensitive' },
          lastName: { equals: lastName, mode: 'insensitive' },
          dateOfBirth,
          status: { not: 'DUPLICATE' },
          ...childAccessWhere(context),
        },
        select: {
          id: true,
          medfinetId: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          sex: true,
          status: true,
        },
        take: 25,
      });
      await transaction.auditEvent.create({
        data: auditData(context, 'child.search', 'child-collection', '*', {
          resultCount: children.length,
        }),
      });
      return children;
    });
  }

  async function listChildren(context, { cursor, limit = 25 } = {}) {
    const take = Math.min(Math.max(Number(limit) || 25, 1), 100);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const records = await transaction.child.findMany({
        where: {
          organizationId: context.organizationId,
          status: { not: 'DUPLICATE' },
          ...childAccessWhere(context),
        },
        orderBy: { id: 'asc' },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = records.length > take;
      const items = hasMore ? records.slice(0, take) : records;
      await transaction.auditEvent.create({
        data: auditData(context, 'child.list', 'child-collection', '*', { resultCount: items.length }),
      });
      return { items, nextCursor: hasMore ? items.at(-1).id : null };
    });
  }

  async function getChild(context, childId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await transaction.child.findFirst({
        where: {
          id: childId,
          organizationId: context.organizationId,
          ...childAccessWhere(context),
        },
        include: { caregivers: { include: { caregiver: true } } },
      });
      if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Child not found');
      await transaction.auditEvent.create({
        data: auditData(context, 'child.read', 'child', child.id),
      });
      return child;
    });
  }

  async function getMyCaregiverProfile(context) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const caregiver = await transaction.caregiver.findFirst({
        where: {
          organizationId: context.organizationId,
          subjectId: context.actorSubjectId,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredLanguage: true,
          phone: true,
          phoneVerifiedAt: true,
          email: true,
          children: {
            select: {
              relationship: true,
              isPrimary: true,
              hasConsentAuthority: true,
              child: {
                select: {
                  id: true,
                  medfinetId: true,
                  firstName: true,
                  lastName: true,
                  status: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!caregiver) {
        throw new DomainError(404, 'CAREGIVER_PROFILE_NOT_FOUND', 'Caregiver profile not found');
      }
      return caregiver;
    });
  }

  async function createCaregiver(context, input) {
    const { normalizeLocale } = require('./localizationService');
    const subjectId = optionalText(input.subjectId, 'subjectId', 160);
    const data = {
      organizationId: context.organizationId,
      firstName: requiredText(input.firstName, 'firstName'),
      lastName: requiredText(input.lastName, 'lastName'),
      preferredLanguage: normalizeLocale(input.preferredLanguage || 'en', 'preferredLanguage'),
      subjectId,
      phone: optionalText(input.phone, 'phone', 40),
      email: optionalText(input.email, 'email', 254),
      createdBySubjectId: context.actorSubjectId,
    };
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const caregiver = await transaction.caregiver.create({ data });
      if (subjectId) {
        const existingMembership = await transaction.organizationMembership.findUnique({
          where: {
            organizationId_subjectId: {
              organizationId: context.organizationId,
              subjectId,
            },
          },
        });
        if (existingMembership && existingMembership.role !== 'CAREGIVER') {
          throw new DomainError(
            409,
            'SUBJECT_HAS_DIFFERENT_ORGANIZATION_ROLE',
            'The caregiver subject already has a different organization role'
          );
        }
        await transaction.organizationMembership.upsert({
          where: {
            organizationId_subjectId: {
              organizationId: context.organizationId,
              subjectId,
            },
          },
          create: {
            organizationId: context.organizationId,
            subjectId,
            role: 'CAREGIVER',
          },
          update: { status: 'ACTIVE' },
        });
      }
      await transaction.auditEvent.create({
        data: auditData(context, 'caregiver.created', 'caregiver', caregiver.id),
      });
      return caregiver;
    });
  }

  async function linkCaregiver(context, childId, input) {
    const relationship = assertEnum(input.relationship, 'relationship', CAREGIVER_RELATIONSHIPS);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const [child, caregiver] = await Promise.all([
        transaction.child.findFirst({ where: { id: childId, organizationId: context.organizationId } }),
        transaction.caregiver.findFirst({ where: { id: input.caregiverId, organizationId: context.organizationId } }),
      ]);
      if (!child || !caregiver) {
        throw new DomainError(404, 'IDENTITY_RECORD_NOT_FOUND', 'Child or caregiver not found');
      }
      const link = await transaction.childCaregiver.create({
        data: {
          organizationId: context.organizationId,
          childId,
          caregiverId: caregiver.id,
          relationship,
          isPrimary: input.isPrimary === true,
          hasConsentAuthority: input.hasConsentAuthority === true,
        },
      });
      await transaction.auditEvent.create({
        data: auditData(context, 'child.caregiver-linked', 'child', childId, { caregiverId: caregiver.id }),
      });
      return link;
    });
  }

  return {
    createOrganization,
    createChild,
    searchChildren,
    listChildren,
    getChild,
    getMyCaregiverProfile,
    createCaregiver,
    linkCaregiver,
  };
}

function auditData(context, action, entityType, entityId, metadata) {
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

module.exports = { createIdentityService, parseDateOfBirth, requiredText };
