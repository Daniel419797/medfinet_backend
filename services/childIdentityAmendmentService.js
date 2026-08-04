const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const {
  parseDateOfBirth,
  requiredText,
} = require('./identityService');

const CHILD_SEXES = new Set(['FEMALE', 'MALE', 'INTERSEX', 'UNKNOWN']);

function normalizeProposedData(input) {
  const proposed = {};
  if (input.firstName !== undefined) {
    proposed.firstName = requiredText(input.firstName, 'firstName', 120);
  }
  if (input.lastName !== undefined) {
    proposed.lastName = requiredText(input.lastName, 'lastName', 120);
  }
  if (input.dateOfBirth !== undefined) {
    proposed.dateOfBirth = parseDateOfBirth(input.dateOfBirth)
      .toISOString()
      .slice(0, 10);
  }
  if (input.sex !== undefined) {
    if (!CHILD_SEXES.has(input.sex)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'sex is unsupported');
    }
    proposed.sex = input.sex;
  }
  if (Object.keys(proposed).length === 0) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'At least one identity correction is required'
    );
  }
  return proposed;
}

function createChildIdentityAmendmentService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function request(context, childId, input) {
    const reason = requiredText(input.reason, 'reason', 1000);
    const proposedData = normalizeProposedData(input);
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
      const amendment = await transaction.childIdentityAmendment.create({
        data: {
          organizationId: context.organizationId,
          childId,
          reason,
          proposedData,
          requestedBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'child-identity-amendment.requested',
          entityType: 'child-identity-amendment',
          entityId: amendment.id,
          purpose: context.purpose,
          metadata: {
            childId,
            changedFields: Object.keys(proposedData),
          },
        },
      });
      return amendment;
    });
  }

  async function review(context, amendmentId, input) {
    if (!['APPLY', 'REJECT'].includes(input.decision)) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'decision must be APPLY or REJECT'
      );
    }
    const reviewReason = requiredText(
      input.reviewReason,
      'reviewReason',
      1000
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const amendment = await transaction.childIdentityAmendment.findFirst({
        where: {
          id: amendmentId,
          organizationId: context.organizationId,
          status: 'PENDING',
        },
      });
      if (!amendment) {
        throw new DomainError(
          404,
          'PENDING_IDENTITY_AMENDMENT_NOT_FOUND',
          'Pending identity amendment not found'
        );
      }
      if (amendment.requestedBySubjectId === context.actorSubjectId) {
        throw new DomainError(
          409,
          'IDENTITY_AMENDMENT_MAKER_CHECKER_REQUIRED',
          'A different authorized worker must review this correction'
        );
      }
      const reviewedAt = new Date();
      if (input.decision === 'REJECT') {
        const rejected = await transaction.childIdentityAmendment.update({
          where: { id: amendment.id },
          data: {
            status: 'REJECTED',
            reviewedBySubjectId: context.actorSubjectId,
            reviewedAt,
            reviewReason,
          },
        });
        await transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'child-identity-amendment.rejected',
            entityType: 'child-identity-amendment',
            entityId: amendment.id,
            purpose: context.purpose,
            metadata: { reviewReason },
          },
        });
        return rejected;
      }
      const child = await transaction.child.findFirst({
        where: {
          id: amendment.childId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      if (!child) {
        throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
      }
      const proposed = amendment.proposedData;
      const next = {
        firstName: proposed.firstName || child.firstName,
        lastName: proposed.lastName || child.lastName,
        dateOfBirth: proposed.dateOfBirth
          ? parseDateOfBirth(proposed.dateOfBirth)
          : child.dateOfBirth,
        sex: proposed.sex || child.sex,
      };
      const duplicates = await transaction.child.count({
        where: {
          organizationId: context.organizationId,
          id: { not: child.id },
          firstName: { equals: next.firstName, mode: 'insensitive' },
          lastName: { equals: next.lastName, mode: 'insensitive' },
          dateOfBirth: next.dateOfBirth,
          status: { not: 'DUPLICATE' },
        },
      });
      if (duplicates > 0) {
        throw new DomainError(
          409,
          'IDENTITY_AMENDMENT_DUPLICATE_CONFLICT',
          'The correction matches another child and requires duplicate review'
        );
      }
      await transaction.child.update({
        where: { id: child.id },
        data: next,
      });
      const applied = await transaction.childIdentityAmendment.update({
        where: { id: amendment.id },
        data: {
          status: 'APPLIED',
          previousData: {
            firstName: child.firstName,
            lastName: child.lastName,
            dateOfBirth: child.dateOfBirth.toISOString().slice(0, 10),
            sex: child.sex,
          },
          reviewedBySubjectId: context.actorSubjectId,
          reviewedAt,
          reviewReason,
          appliedAt: reviewedAt,
        },
      });
      await Promise.all([
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'child-identity-amendment.applied',
            entityType: 'child-identity-amendment',
            entityId: amendment.id,
            purpose: context.purpose,
            metadata: {
              childId: child.id,
              changedFields: Object.keys(proposed),
              reviewReason,
            },
          },
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
            aggregateType: 'blockchain-anchor',
            aggregateId: amendment.id,
            idempotencyKey: `blockchain:4:${amendment.id}`,
            payload: {
              eventCode: 0x04,
              anchorId: `identity-amendment:${amendment.id}`,
              tenantId: context.organizationId,
            },
          },
        }),
      ]);
      return applied;
    });
  }

  async function list(context, childId) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.childIdentityAmendment.findMany({
        where: {
          organizationId: context.organizationId,
          childId,
        },
        orderBy: { requestedAt: 'desc' },
        take: 100,
      })
    ));
  }

  return { request, review, list };
}

module.exports = {
  createChildIdentityAmendmentService,
  normalizeProposedData,
};
