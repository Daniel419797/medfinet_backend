const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { boundedInteger } = require('./clinicalService');
const { requiredText } = require('./identityService');

const ACTIVATION_ROLES = new Set(['HEALTH_WORKER', 'EMERGENCY_COORDINATOR']);
const REVIEW_ROLES = new Set(['OWNER', 'ADMIN']);
const REVIEW_DECISIONS = new Set(['APPROVED', 'FLAGGED']);

function createEmergencyAccessService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function activate(context, childId, input) {
    if (!ACTIVATION_ROLES.has(context.role)) {
      throw new DomainError(403, 'EMERGENCY_ROLE_REQUIRED', 'This role cannot activate emergency access');
    }
    if (!(context.authenticatedAt instanceof Date)) {
      throw new DomainError(
        403,
        'STEP_UP_AUTHENTICATION_REQUIRED',
        'Verified step-up authentication is required'
      );
    }
    const durationMinutes = boundedInteger(input.durationMinutes, 'durationMinutes', {
      min: 5,
      max: 30,
    });
    const activatedAt = now();
    const expiresAt = new Date(activatedAt.valueOf() + durationMinutes * 60 * 1000);

    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await transaction.child.findFirst({
        where: { id: childId, organizationId: context.organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');

      await transaction.emergencyAccess.updateMany({
        where: {
          organizationId: context.organizationId,
          childId,
          actorSubjectId: context.actorSubjectId,
          status: 'ACTIVE',
          expiresAt: { lte: activatedAt },
        },
        data: { status: 'EXPIRED' },
      });
      const existing = await transaction.emergencyAccess.findFirst({
        where: {
          organizationId: context.organizationId,
          childId,
          actorSubjectId: context.actorSubjectId,
          status: 'ACTIVE',
          expiresAt: { gt: activatedAt },
        },
        select: { id: true, expiresAt: true },
      });
      if (existing) {
        throw new DomainError(
          409,
          'EMERGENCY_ACCESS_ALREADY_ACTIVE',
          'An emergency access session is already active',
          existing
        );
      }

      const access = await transaction.emergencyAccess.create({
        data: {
          organizationId: context.organizationId,
          childId,
          actorSubjectId: context.actorSubjectId,
          reasonCode: requiredText(input.reasonCode, 'reasonCode', 80),
          justification: requiredText(input.justification, 'justification', 1000),
          stepUpAuthenticatedAt: context.authenticatedAt,
          activatedAt,
          expiresAt,
        },
      });
      await Promise.all([
        transaction.auditEvent.create({
          data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'emergency-access.activated',
          entityType: 'emergency-access',
          entityId: access.id,
          purpose: context.purpose,
          metadata: {
            childId,
            reasonCode: access.reasonCode,
            expiresAt: access.expiresAt.toISOString(),
          },
          },
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'EMERGENCY_ACCESS_ACTIVATED',
            aggregateType: 'emergency-access',
            aggregateId: access.id,
            idempotencyKey: `emergency-access:${access.id}:caregiver-notification`,
            payload: { emergencyAccessId: access.id },
          },
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
            aggregateType: 'blockchain-anchor',
            aggregateId: access.id,
            idempotencyKey: `blockchain:3:${access.id}`,
            payload: {
              eventCode: 0x03,
              anchorId: `emergency:${access.id}`,
              tenantId: context.organizationId,
            },
          },
        }),
      ]);
      return access;
    });
  }

  async function getEmergencyProfile(context, childId, accessId) {
    const normalizedAccessId = requiredText(accessId, 'emergencyAccessId', 100);
    const currentTime = now();
    const result = await withTenantTransaction(
      database,
      context.organizationId,
      async (transaction) => {
        const access = await transaction.emergencyAccess.findFirst({
          where: {
            id: normalizedAccessId,
            organizationId: context.organizationId,
            childId,
            actorSubjectId: context.actorSubjectId,
            status: 'ACTIVE',
            expiresAt: { gt: currentTime },
          },
        });
        if (!access) {
          const disclosure = await transaction.disclosureEvent.create({
            data: {
              organizationId: context.organizationId,
              childId,
              actorSubjectId: context.actorSubjectId,
              recipientType: 'ORGANIZATION',
              recipientId: context.organizationId,
              purpose: context.purpose,
              requestedScopes: [
                { category: 'EMERGENCY_PROFILE', access: 'READ' },
              ],
              decision: 'DENIED',
              reasonCode: 'INVALID_EMERGENCY_ACCESS',
              requestId: context.requestId,
            },
          });
          return { deniedDisclosureEventId: disclosure.id };
        }

        const child = await transaction.child.findFirst({
          where: { id: childId, organizationId: context.organizationId, status: 'ACTIVE' },
          select: {
            id: true,
            medfinetId: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            sex: true,
            caregivers: {
              where: { isPrimary: true },
              take: 1,
              select: {
                relationship: true,
                caregiver: {
                  select: {
                    firstName: true,
                    lastName: true,
                    phone: true,
                    preferredLanguage: true,
                  },
                },
              },
            },
            immunizations: {
              where: { status: { in: ['ACTIVE', 'AMENDED'] } },
              orderBy: { administeredAt: 'desc' },
              take: 20,
              select: {
                vaccineCode: true,
                doseNumber: true,
                administeredAt: true,
              },
            },
            growthMeasurements: {
              where: { status: { in: ['ACTIVE', 'AMENDED'] } },
              orderBy: { measuredAt: 'desc' },
              take: 1,
              select: {
                measuredAt: true,
                weightGrams: true,
                heightMillimeters: true,
                muacMillimeters: true,
                oedemaPresent: true,
              },
            },
            clinicalAlerts: {
              where: {
                status: 'ACTIVE',
                emergencyVisible: true,
              },
              orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
              select: {
                category: true,
                severity: true,
                summary: true,
              },
            },
            allergies: {
              where: { status: 'ACTIVE' },
              orderBy: [
                { severity: 'desc' },
                { createdAt: 'desc' },
              ],
              select: {
                substanceCode: true,
                substanceDisplay: true,
                reaction: true,
                severity: true,
                criticality: true,
              },
            },
            appointments: {
              where: {
                status: 'SCHEDULED',
                scheduledFor: { gte: currentTime },
              },
              orderBy: { scheduledFor: 'asc' },
              take: 3,
              select: {
                kind: true,
                scheduledFor: true,
              },
            },
          },
        });
        if (!child) {
          return { childNotFound: true };
        }

        const disclosure = await transaction.disclosureEvent.create({
          data: {
            organizationId: context.organizationId,
            childId,
            actorSubjectId: context.actorSubjectId,
            recipientType: 'ORGANIZATION',
            recipientId: context.organizationId,
            purpose: context.purpose,
            requestedScopes: [
              { category: 'EMERGENCY_PROFILE', access: 'READ' },
            ],
            decision: 'ALLOWED',
            reasonCode: 'ACTIVE_EMERGENCY_ACCESS',
            emergencyAccessId: access.id,
            requestId: context.requestId,
          },
        });
        await transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'emergency-profile.read',
            entityType: 'child',
            entityId: childId,
            purpose: context.purpose,
            metadata: {
              emergencyAccessId: access.id,
              disclosureEventId: disclosure.id,
            },
          },
        });
        return {
          access: {
            id: access.id,
            reasonCode: access.reasonCode,
            expiresAt: access.expiresAt,
          },
          profile: child,
          disclosureEventId: disclosure.id,
        };
      }
    );

    if (result.deniedDisclosureEventId) {
      throw new DomainError(
        403,
        'EMERGENCY_ACCESS_DENIED',
        'Emergency access is invalid, expired, revoked, or belongs to another actor',
        { disclosureEventId: result.deniedDisclosureEventId }
      );
    }
    if (result.childNotFound) {
      throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
    }
    return result;
  }

  async function review(context, accessId, input) {
    if (!REVIEW_ROLES.has(context.role)) {
      throw new DomainError(403, 'EMERGENCY_REVIEW_DENIED', 'This role cannot review emergency access');
    }
    if (!REVIEW_DECISIONS.has(input.decision)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'decision must be APPROVED or FLAGGED');
    }
    const reviewNotes = requiredText(input.reviewNotes, 'reviewNotes', 1000);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.emergencyAccess.findFirst({
        where: { id: accessId, organizationId: context.organizationId },
      });
      if (!existing) {
        throw new DomainError(404, 'EMERGENCY_ACCESS_NOT_FOUND', 'Emergency access not found');
      }
      if (existing.reviewStatus !== 'PENDING') {
        throw new DomainError(409, 'EMERGENCY_ACCESS_ALREADY_REVIEWED', 'Emergency access was already reviewed');
      }
      const reviewedAt = now();
      const shouldRevoke = input.decision === 'FLAGGED'
        && existing.status === 'ACTIVE'
        && existing.expiresAt > reviewedAt;
      const access = await transaction.emergencyAccess.update({
        where: { id: existing.id },
        data: {
          reviewStatus: input.decision,
          reviewerSubjectId: context.actorSubjectId,
          reviewedAt,
          reviewNotes,
          ...(shouldRevoke
            ? {
              status: 'REVOKED',
              revokedAt: reviewedAt,
              revokedBySubjectId: context.actorSubjectId,
            }
            : {}),
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'emergency-access.reviewed',
          entityType: 'emergency-access',
          entityId: access.id,
          purpose: context.purpose,
          metadata: {
            decision: input.decision,
            accessActorSubjectId: access.actorSubjectId,
            childId: access.childId,
            revoked: shouldRevoke,
          },
        },
      });
      return access;
    });
  }

  return { activate, getEmergencyProfile, review };
}

module.exports = { createEmergencyAccessService };
