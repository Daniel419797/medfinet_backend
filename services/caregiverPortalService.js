const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { normalizeLocale } = require('./localizationService');

const RELATIONSHIPS = new Set(['MOTHER', 'FATHER', 'GUARDIAN', 'RELATIVE', 'OTHER']);

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maxLength);
}

function createCaregiverPortalService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function connectParent(context, input, account) {
    const childId = requiredText(input.childId, 'childId', 160);
    const firstName = requiredText(input.firstName, 'firstName', 120);
    const lastName = requiredText(input.lastName, 'lastName', 120);
    const relationship = requiredText(input.relationship, 'relationship', 40).toUpperCase();
    if (!RELATIONSHIPS.has(relationship)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'relationship has an unsupported value');
    }
    if (!account?.subjectId) {
      throw new DomainError(400, 'ACCOUNT_REQUIRED', 'A verified Medfinet account is required');
    }
    const preferredLanguage = normalizeLocale(input.preferredLanguage || 'en', 'preferredLanguage');
    const phone = optionalText(input.phone, 'phone', 40);

    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await transaction.child.findFirst({
        where: {
          id: childId,
          organizationId: context.organizationId,
          status: { not: 'DUPLICATE' },
        },
        select: { id: true, firstName: true, lastName: true, medfinetId: true },
      });
      if (!child) {
        throw new DomainError(404, 'CHILD_NOT_FOUND', 'Child not found in this organization');
      }

      const existingMembership = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_subjectId: {
            organizationId: context.organizationId,
            subjectId: account.subjectId,
          },
        },
      });
      if (existingMembership && existingMembership.role !== 'CAREGIVER') {
        throw new DomainError(
          409,
          'SUBJECT_HAS_DIFFERENT_ORGANIZATION_ROLE',
          'This account already has a different role in the organization'
        );
      }

      let caregiver = await transaction.caregiver.findUnique({
        where: {
          organizationId_subjectId: {
            organizationId: context.organizationId,
            subjectId: account.subjectId,
          },
        },
      });

      if (!caregiver && account.email) {
        const unlinkedMatches = await transaction.caregiver.findMany({
          where: {
            organizationId: context.organizationId,
            subjectId: null,
            email: { equals: account.email, mode: 'insensitive' },
          },
          orderBy: { createdAt: 'asc' },
          take: 2,
        });
        if (unlinkedMatches.length > 1) {
          throw new DomainError(
            409,
            'AMBIGUOUS_CAREGIVER_RECORD',
            'More than one unlinked caregiver record uses this email. Resolve the duplicate records before connecting portal access.'
          );
        }
        caregiver = unlinkedMatches[0] || null;
      }

      if (caregiver) {
        caregiver = await transaction.caregiver.update({
          where: { id: caregiver.id },
          data: {
            firstName,
            lastName,
            preferredLanguage,
            subjectId: account.subjectId,
            ...(phone ? { phone } : {}),
            ...(account.email ? { email: account.email } : {}),
          },
        });
      } else {
        caregiver = await transaction.caregiver.create({
          data: {
            organizationId: context.organizationId,
            firstName,
            lastName,
            preferredLanguage,
            subjectId: account.subjectId,
            phone,
            email: account.email,
            createdBySubjectId: context.actorSubjectId,
          },
        });
      }

      const membership = await transaction.organizationMembership.upsert({
        where: {
          organizationId_subjectId: {
            organizationId: context.organizationId,
            subjectId: account.subjectId,
          },
        },
        create: {
          organizationId: context.organizationId,
          subjectId: account.subjectId,
          role: 'CAREGIVER',
          status: 'ACTIVE',
          scopeMode: 'GLOBAL',
        },
        update: {
          role: 'CAREGIVER',
          status: 'ACTIVE',
          scopeMode: 'GLOBAL',
        },
      });

      const link = await transaction.childCaregiver.upsert({
        where: {
          childId_caregiverId: {
            childId: child.id,
            caregiverId: caregiver.id,
          },
        },
        create: {
          organizationId: context.organizationId,
          childId: child.id,
          caregiverId: caregiver.id,
          relationship,
          isPrimary: input.isPrimary === true,
          hasConsentAuthority: input.hasConsentAuthority === true,
        },
        update: {
          relationship,
          isPrimary: input.isPrimary === true,
          hasConsentAuthority: input.hasConsentAuthority === true,
        },
      });

      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'caregiver.portal-connected',
          entityType: 'caregiver',
          entityId: caregiver.id,
          purpose: context.purpose,
          metadata: {
            childId: child.id,
            subjectId: account.subjectId,
            relationship,
            isPrimary: link.isPrimary,
            hasConsentAuthority: link.hasConsentAuthority,
          },
        },
      });

      return {
        caregiver: {
          id: caregiver.id,
          firstName: caregiver.firstName,
          lastName: caregiver.lastName,
          email: caregiver.email,
          subjectId: caregiver.subjectId,
        },
        membership: {
          id: membership.id,
          role: membership.role,
          status: membership.status,
        },
        child,
        relationship: {
          relationship: link.relationship,
          isPrimary: link.isPrimary,
          hasConsentAuthority: link.hasConsentAuthority,
        },
      };
    });
  }

  return { connectParent };
}

module.exports = { createCaregiverPortalService, RELATIONSHIPS };
