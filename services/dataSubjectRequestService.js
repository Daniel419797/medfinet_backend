const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const REQUEST_TYPES = new Set([
  'ACCESS',
  'RECTIFICATION',
  'ERASURE',
  'RESTRICTION',
  'PORTABILITY',
  'OBJECTION',
]);
const ADMIN_ROLES = new Set(['OWNER', 'ADMIN', 'AUDITOR']);
const RESPONSE_DAYS = 30;

function createDataSubjectRequestService(
  prismaClient,
  { now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function authorizeSubject(transaction, context, input) {
    const caregiver = input.caregiverId
      ? await transaction.caregiver.findFirst({
        where: {
          id: input.caregiverId,
          organizationId: context.organizationId,
        },
        select: { id: true, subjectId: true },
      })
      : null;
    if (input.caregiverId && !caregiver) {
      throw new DomainError(
        404,
        'DATA_SUBJECT_NOT_FOUND',
        'Caregiver data subject not found'
      );
    }
    if (
      caregiver
      && caregiver.subjectId !== context.actorSubjectId
      && !ADMIN_ROLES.has(context.role)
    ) {
      throw new DomainError(
        403,
        'DATA_SUBJECT_REQUEST_FORBIDDEN',
        'The caregiver does not belong to the authenticated subject'
      );
    }
    if (input.childId) {
      const child = await transaction.child.findFirst({
        where: {
          id: input.childId,
          organizationId: context.organizationId,
        },
        select: { id: true },
      });
      if (!child) {
        throw new DomainError(
          404,
          'DATA_SUBJECT_NOT_FOUND',
          'Child data subject not found'
        );
      }
      if (!ADMIN_ROLES.has(context.role)) {
        if (!caregiver) {
          throw new DomainError(
            403,
            'CAREGIVER_AUTHORITY_REQUIRED',
            'A verified caregiver is required for a child request'
          );
        }
        const authority = await transaction.childCaregiver.findFirst({
          where: {
            organizationId: context.organizationId,
            childId: input.childId,
            caregiverId: caregiver.id,
            hasConsentAuthority: true,
          },
          select: { id: true },
        });
        if (!authority) {
          throw new DomainError(
            403,
            'CAREGIVER_AUTHORITY_REQUIRED',
            'The caregiver lacks authority for this child'
          );
        }
      }
    }
    if (!caregiver && !input.childId) {
      throw new DomainError(
        400,
        'DATA_SUBJECT_REQUIRED',
        'A caregiver or child data subject is required'
      );
    }
  }

  async function submit(context, input) {
    if (!REQUEST_TYPES.has(input.requestType)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'requestType is invalid');
    }
    const requestDetails = requiredText(
      input.requestDetails,
      'requestDetails',
      2000
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await authorizeSubject(transaction, context, input);
      const submittedAt = now();
      const request = await transaction.dataSubjectRequest.create({
        data: {
          organizationId: context.organizationId,
          caregiverId: input.caregiverId || null,
          childId: input.childId || null,
          requestType: input.requestType,
          requestDetails,
          submittedBySubjectId: context.actorSubjectId,
          submittedAt,
          dueAt: new Date(
            submittedAt.getTime() + RESPONSE_DAYS * 24 * 60 * 60 * 1000
          ),
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'data-subject-request.submitted',
          entityType: 'data-subject-request',
          entityId: request.id,
          purpose: context.purpose,
          metadata: {
            requestType: request.requestType,
            dueAt: request.dueAt.toISOString(),
          },
        },
      });
      return request;
    });
  }

  async function verifyIdentity(context, requestId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.dataSubjectRequest.findFirst({
        where: {
          id: requestId,
          organizationId: context.organizationId,
          status: 'RECEIVED',
        },
      });
      if (!existing) {
        throw new DomainError(
          409,
          'DATA_SUBJECT_REQUEST_NOT_VERIFIABLE',
          'Request is not awaiting identity verification'
        );
      }
      if (existing.submittedBySubjectId === context.actorSubjectId) {
        throw new DomainError(
          409,
          'DATA_SUBJECT_REQUEST_MAKER_CHECKER_REQUIRED',
          'A different authorized worker must verify identity'
        );
      }
      const verifiedAt = now();
      const request = await transaction.dataSubjectRequest.update({
        where: { id: requestId },
        data: {
          status: 'IDENTITY_VERIFIED',
          identityVerifiedBySubjectId: context.actorSubjectId,
          identityVerifiedAt: verifiedAt,
          assignedToSubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'data-subject-request.identity-verified',
          entityType: 'data-subject-request',
          entityId: requestId,
          purpose: context.purpose,
        },
      });
      return request;
    });
  }

  async function decide(context, requestId, input) {
    if (!['APPROVED', 'DENIED'].includes(input.decision)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'decision is invalid');
    }
    const decisionReason = requiredText(
      input.decisionReason,
      'decisionReason',
      2000
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const decidedAt = now();
      const updated = await transaction.dataSubjectRequest.updateMany({
        where: {
          id: requestId,
          organizationId: context.organizationId,
          status: { in: ['IDENTITY_VERIFIED', 'IN_REVIEW'] },
          identityVerifiedAt: { not: null },
        },
        data: {
          status: input.decision,
          decision: input.decision,
          decisionReason,
          decidedBySubjectId: context.actorSubjectId,
          decidedAt,
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'DATA_SUBJECT_REQUEST_NOT_DECIDABLE',
          'Request must be identity-verified before a decision'
        );
      }
      await Promise.all([
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: `data-subject-request.${input.decision.toLowerCase()}`,
            entityType: 'data-subject-request',
            entityId: requestId,
            purpose: context.purpose,
            metadata: { decisionReason },
          },
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
            aggregateType: 'blockchain-anchor',
            aggregateId: requestId,
            idempotencyKey: `blockchain:5:${requestId}:${input.decision.toLowerCase()}`,
            payload: {
              eventCode: 0x05,
              anchorId: `data-subject-request:${requestId}:${input.decision.toLowerCase()}`,
              tenantId: context.organizationId,
            },
          },
        }),
      ]);
      return transaction.dataSubjectRequest.findUnique({
        where: { id: requestId },
      });
    });
  }

  async function complete(context, requestId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const completedAt = now();
      const updated = await transaction.dataSubjectRequest.updateMany({
        where: {
          id: requestId,
          organizationId: context.organizationId,
          status: 'APPROVED',
        },
        data: { status: 'COMPLETED', completedAt },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'DATA_SUBJECT_REQUEST_NOT_COMPLETABLE',
          'Only an approved request can be completed'
        );
      }
      await Promise.all([
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'data-subject-request.completed',
            entityType: 'data-subject-request',
            entityId: requestId,
            purpose: context.purpose,
          },
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
            aggregateType: 'blockchain-anchor',
            aggregateId: requestId,
            idempotencyKey: `blockchain:5:${requestId}:completed`,
            payload: {
              eventCode: 0x05,
              anchorId: `data-subject-request:${requestId}:completed`,
              tenantId: context.organizationId,
            },
          },
        }),
      ]);
      return transaction.dataSubjectRequest.findUnique({
        where: { id: requestId },
      });
    });
  }

  async function list(context, input = {}) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.dataSubjectRequest.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.status ? { status: input.status } : {}),
          ...(!ADMIN_ROLES.has(context.role)
            ? { submittedBySubjectId: context.actorSubjectId }
            : {}),
        },
        orderBy: [{ dueAt: 'asc' }, { submittedAt: 'asc' }],
        take: 100,
      })
    ));
  }

  return {
    submit,
    verifyIdentity,
    decide,
    complete,
    list,
  };
}

module.exports = {
  createDataSubjectRequestService,
  REQUEST_TYPES,
  ADMIN_ROLES,
  RESPONSE_DAYS,
};
