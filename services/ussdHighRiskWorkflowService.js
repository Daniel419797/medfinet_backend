const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

const USSD_CONSENT_CATEGORIES = new Set([
  'IDENTITY', 'DEMOGRAPHICS', 'IMMUNIZATION', 'NUTRITION',
  'APPOINTMENTS', 'SERVICE_DELIVERY', 'REWARDS',
]);

function audit(context, action, entityType, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: `ussd:${context.sessionId}`,
    action,
    entityType,
    entityId,
    purpose: 'caregiver-ussd-high-assurance',
    ...(metadata ? { metadata } : {}),
  };
}

function createUssdHighRiskWorkflowService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function eligibleNfcCards(context) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.childCredential.findMany({
        where: {
          organizationId: context.organizationId,
          kind: 'NFC',
          status: { in: ['ACTIVE', 'SUSPENDED'] },
          child: {
            status: 'ACTIVE',
            caregivers: { some: { caregiverId: context.caregiverId } },
          },
        },
        select: {
          id: true,
          childId: true,
          status: true,
          nfcBinding: { select: { id: true, status: true } },
          child: { select: { firstName: true } },
        },
        take: 10,
      })
    ));
  }

  async function requestCardSupport(context, credentialId, requestType) {
    if (!['LOST_CARD_SUSPENSION', 'REPLACEMENT_REQUEST'].includes(requestType)) {
      throw new DomainError(400, 'USSD_CARD_REQUEST_INVALID', 'Card request type is invalid');
    }
    const currentTime = now();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.nfcCardSupportRequest.findUnique({
        where: { sourceSessionId: context.sessionId },
      });
      if (replay) {
        if (replay.organizationId !== context.organizationId
          || replay.caregiverId !== context.caregiverId
          || replay.credentialId !== credentialId || replay.requestType !== requestType) {
          throw new DomainError(409, 'USSD_IDEMPOTENCY_CONFLICT', 'Session action does not match its recorded card request');
        }
        return replay;
      }
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "child_credentials" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
        credentialId,
        context.organizationId
      );
      const credential = await transaction.childCredential.findFirst({
        where: {
          id: credentialId,
          organizationId: context.organizationId,
          kind: 'NFC',
          status: { in: ['ACTIVE', 'SUSPENDED'] },
          child: { caregivers: { some: { caregiverId: context.caregiverId } } },
        },
        include: { nfcBinding: true },
      });
      if (!credential?.nfcBinding) {
        throw new DomainError(404, 'NFC_CARD_NOT_FOUND', 'Accessible NFC card not found');
      }
      const suspend = requestType === 'LOST_CARD_SUSPENSION' && credential.status === 'ACTIVE';
      if (suspend) {
        await transaction.childCredential.update({
          where: { id: credential.id },
          data: { status: 'SUSPENDED' },
        });
        await transaction.nfcCredentialBinding.update({
          where: { id: credential.nfcBinding.id },
          data: { status: 'SUSPENDED' },
        });
      }
      const request = await transaction.nfcCardSupportRequest.create({
        data: {
          organizationId: context.organizationId,
          caregiverId: context.caregiverId,
          childId: credential.childId,
          credentialId: credential.id,
          requestType,
          sourceSessionId: context.sessionId,
          ...(suspend ? { temporarySuspendedAt: currentTime } : {}),
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'ussd.nfc-card-support-requested', 'nfc-card-support-request', request.id, {
          requestType,
          cardSuspended: suspend,
        }),
      });
      return request;
    });
  }

  async function pendingConsent(context) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.ussdConsentRequest.findFirst({
        where: {
          organizationId: context.organizationId,
          caregiverId: context.caregiverId,
          status: 'PENDING',
          expiresAt: { gt: now() },
        },
        select: {
          id: true,
          recipientDisplayName: true,
          purpose: true,
          requestedScopes: true,
          expiresAt: true,
        },
        orderBy: { createdAt: 'asc' },
      })
    ));
  }

  async function decideConsent(context, requestId, decision) {
    if (!['APPROVE', 'DECLINE'].includes(decision)) {
      throw new DomainError(400, 'USSD_CONSENT_DECISION_INVALID', 'Consent decision is invalid');
    }
    const currentTime = now();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.ussdConsentRequest.findFirst({
        where: { sourceSessionId: context.sessionId, organizationId: context.organizationId },
      });
      if (replay) {
        const expected = decision === 'APPROVE' ? 'APPROVED' : 'DECLINED';
        if (replay.caregiverId !== context.caregiverId || replay.id !== requestId || replay.status !== expected) {
          throw new DomainError(409, 'USSD_IDEMPOTENCY_CONFLICT', 'Session action does not match its recorded consent decision');
        }
        return replay;
      }
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "ussd_consent_requests" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
        requestId,
        context.organizationId
      );
      const request = await transaction.ussdConsentRequest.findFirst({
        where: {
          id: requestId,
          organizationId: context.organizationId,
          caregiverId: context.caregiverId,
          status: 'PENDING',
          expiresAt: { gt: currentTime },
        },
      });
      if (!request) throw new DomainError(404, 'USSD_CONSENT_REQUEST_NOT_FOUND', 'Consent request is unavailable');
      const scopes = request.requestedScopes;
      if (
        !Array.isArray(scopes)
        || scopes.length < 1
        || scopes.length > 4
        || scopes.some((scope) => (
          !USSD_CONSENT_CATEGORIES.has(scope?.category) || scope?.access !== 'READ'
        ))
      ) {
        throw new DomainError(409, 'USSD_CONSENT_SCOPE_UNSAFE', 'Consent request cannot be decided through USSD');
      }
      let grant = null;
      if (decision === 'APPROVE') {
        const authority = await transaction.childCaregiver.findFirst({
          where: {
            organizationId: context.organizationId,
            childId: request.childId,
            caregiverId: context.caregiverId,
            hasConsentAuthority: true,
          },
          select: { id: true },
        });
        if (!authority) {
          throw new DomainError(403, 'CONSENT_AUTHORITY_REQUIRED', 'Consent authority is required');
        }
        grant = await transaction.consentGrant.create({
          data: {
            organizationId: context.organizationId,
            childId: request.childId,
            grantedByCaregiverId: context.caregiverId,
            recipientType: request.recipientType,
            recipientId: request.recipientId,
            purpose: request.purpose,
            legalBasis: request.legalBasis,
            policyVersion: request.policyVersion,
            captureMethod: 'USSD_PIN_OTP',
            evidence: { ussdRequestId: request.id, sessionId: context.sessionId },
            startsAt: currentTime,
            expiresAt: request.expiresAt,
            createdBySubjectId: `ussd:${context.sessionId}`,
            scopes: {
              createMany: { data: scopes.map((scope) => ({
                category: scope.category,
                access: 'READ',
              })) },
            },
          },
        });
      }
      const updated = await transaction.ussdConsentRequest.update({
        where: { id: request.id },
        data: {
          status: decision === 'APPROVE' ? 'APPROVED' : 'DECLINED',
          decidedAt: currentTime,
          sourceSessionId: context.sessionId,
          ...(grant ? { consentGrantId: grant.id } : {}),
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, `ussd.consent-${decision.toLowerCase()}d`, 'ussd-consent-request', request.id, {
          categories: scopes.map(({ category }) => category),
        }),
      });
      return updated;
    });
  }

  async function rewardBalance(context) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const account = await transaction.rewardAccount.findFirst({
        where: {
          organizationId: context.organizationId,
          caregiverId: context.caregiverId,
          status: 'ACTIVE',
        },
        select: { id: true, balance: true, reservedBalance: true },
      });
      return account || { id: null, balance: 0n, reservedBalance: 0n };
    });
  }

  async function pendingRewardReservation(context) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.rewardReservation.findFirst({
        where: {
          organizationId: context.organizationId,
          status: 'ACTIVE',
          expiresAt: { gt: now() },
          rewardAccount: { caregiverId: context.caregiverId, status: 'ACTIVE' },
          ussdConfirmation: null,
        },
        select: {
          id: true,
          amount: true,
          category: true,
          expiresAt: true,
          merchant: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    ));
  }

  async function eligibleRewardItems(context) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.merchant.findMany({
        where: { organizationId: context.organizationId, status: 'ACTIVE' },
        select: { id: true, name: true, eligibleCategories: true },
        orderBy: { name: 'asc' },
        take: 5,
      })
    ));
  }

  async function confirmRewardReservation(context, reservationId, decision) {
    if (!['CONFIRMED', 'DECLINED', 'DISPUTED'].includes(decision)) {
      throw new DomainError(400, 'USSD_REWARD_DECISION_INVALID', 'Reward decision is invalid');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.rewardRedemptionConfirmation.findUnique({
        where: { sourceSessionId: context.sessionId },
      });
      if (replay) {
        if (replay.organizationId !== context.organizationId
          || replay.caregiverId !== context.caregiverId
          || replay.rewardReservationId !== reservationId || replay.decision !== decision) {
          throw new DomainError(409, 'USSD_IDEMPOTENCY_CONFLICT', 'Session action does not match its recorded reward response');
        }
        return replay;
      }
      const reservation = await transaction.rewardReservation.findFirst({
        where: {
          id: reservationId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          expiresAt: { gt: now() },
          rewardAccount: { caregiverId: context.caregiverId, status: 'ACTIVE' },
          ussdConfirmation: null,
        },
        select: { id: true },
      });
      if (!reservation) {
        throw new DomainError(404, 'REWARD_RESERVATION_NOT_FOUND', 'Reward reservation is unavailable');
      }
      const confirmation = await transaction.rewardRedemptionConfirmation.create({
        data: {
          organizationId: context.organizationId,
          caregiverId: context.caregiverId,
          rewardReservationId: reservation.id,
          decision,
          sourceSessionId: context.sessionId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'ussd.reward-reservation-response-recorded', 'reward-reservation', reservation.id, {
          decision,
        }),
      });
      return confirmation;
    });
  }

  return {
    confirmRewardReservation,
    decideConsent,
    eligibleRewardItems,
    eligibleNfcCards,
    pendingConsent,
    pendingRewardReservation,
    requestCardSupport,
    rewardBalance,
  };
}

module.exports = { createUssdHighRiskWorkflowService, USSD_CONSENT_CATEGORIES };
