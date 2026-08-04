const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const RECIPIENT_TYPES = new Set(['ORGANIZATION', 'PROGRAMME', 'PARTNER', 'RESEARCH']);
const DATA_CATEGORIES = new Set([
  'IDENTITY',
  'DEMOGRAPHICS',
  'CAREGIVER',
  'IMMUNIZATION',
  'NUTRITION',
  'CLINICAL_ALERTS',
  'APPOINTMENTS',
  'EMERGENCY_PROFILE',
  'CLIMATE',
  'SERVICE_DELIVERY',
  'REWARDS',
]);
const ACCESS_LEVELS = new Set(['READ', 'WRITE']);
const WITHDRAWAL_ROLES = new Set(['OWNER', 'ADMIN']);

function consentTimestamp(value, field, { required = false } = {}) {
  if (!value && !required) return null;
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.valueOf())) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} must be a valid timestamp`);
  }
  return parsed;
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > DATA_CATEGORIES.size) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `scopes must contain between 1 and ${DATA_CATEGORIES.size} entries`
    );
  }
  const normalized = scopes.map((scope) => {
    if (!DATA_CATEGORIES.has(scope?.category)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'A consent scope category is unsupported');
    }
    if (!ACCESS_LEVELS.has(scope?.access)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'A consent scope access must be READ or WRITE');
    }
    return { category: scope.category, access: scope.access };
  });
  if (new Set(normalized.map(({ category }) => category)).size !== normalized.length) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'Consent scope categories must be unique');
  }
  return normalized;
}

function validateRecipient(input) {
  if (!RECIPIENT_TYPES.has(input.recipientType)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'recipientType is unsupported');
  }
  return {
    recipientType: input.recipientType,
    recipientId: requiredText(input.recipientId, 'recipientId', 160),
  };
}

function scopeAllows(grantedAccess, requestedAccess) {
  return grantedAccess === requestedAccess || (grantedAccess === 'WRITE' && requestedAccess === 'READ');
}

function grantCoversScopes(grant, requestedScopes) {
  return requestedScopes.every((requested) => grant.scopes.some(
    (granted) => granted.category === requested.category
      && scopeAllows(granted.access, requested.access)
  ));
}

function createConsentService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function requireActiveChild(transaction, context, childId) {
    const child = await transaction.child.findFirst({
      where: { id: childId, organizationId: context.organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
  }

  async function grantConsent(context, childId, input) {
    const recipient = validateRecipient(input);
    const scopes = normalizeScopes(input.scopes);
    const startsAt = consentTimestamp(input.startsAt, 'startsAt') || new Date();
    const expiresAt = consentTimestamp(input.expiresAt, 'expiresAt');
    if (expiresAt && expiresAt <= startsAt) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'expiresAt must be later than startsAt');
    }
    const caregiverId = requiredText(input.grantedByCaregiverId, 'grantedByCaregiverId', 100);

    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await requireActiveChild(transaction, context, childId);
      const authority = await transaction.childCaregiver.findFirst({
        where: {
          organizationId: context.organizationId,
          childId,
          caregiverId,
          hasConsentAuthority: true,
        },
        include: { caregiver: { select: { subjectId: true } } },
      });
      if (!authority) {
        throw new DomainError(
          403,
          'CONSENT_AUTHORITY_REQUIRED',
          'The selected caregiver cannot grant consent for this child'
        );
      }

      const grant = await transaction.consentGrant.create({
        data: {
          organizationId: context.organizationId,
          childId,
          grantedByCaregiverId: caregiverId,
          ...recipient,
          purpose: requiredText(input.purpose, 'purpose', 160),
          legalBasis: requiredText(input.legalBasis, 'legalBasis', 160),
          policyVersion: requiredText(input.policyVersion, 'policyVersion', 80),
          captureMethod: requiredText(input.captureMethod, 'captureMethod', 80),
          ...(input.evidence ? { evidence: input.evidence } : {}),
          startsAt,
          ...(expiresAt ? { expiresAt } : {}),
          createdBySubjectId: context.actorSubjectId,
          scopes: {
            createMany: { data: scopes.map((scope) => ({
              ...scope,
            })) },
          },
        },
        include: { scopes: true },
      });
      await Promise.all([
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'consent.granted',
            entityType: 'consent',
            entityId: grant.id,
            purpose: context.purpose,
            metadata: {
              childId,
              recipientType: grant.recipientType,
              recipientId: grant.recipientId,
              categories: scopes.map(({ category }) => category),
            },
          },
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
            aggregateType: 'blockchain-anchor',
            aggregateId: grant.id,
            idempotencyKey: `blockchain:1:${grant.id}`,
            payload: {
              eventCode: 0x01,
              anchorId: `consent:${grant.id}`,
              tenantId: context.organizationId,
            },
          },
        }),
      ]);
      return grant;
    });
  }

  async function listConsents(context, childId, input = {}) {
    const statuses = input.includeInactive === true
      ? ['ACTIVE', 'WITHDRAWN', 'EXPIRED', 'REVOKED']
      : ['ACTIVE'];
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await requireActiveChild(transaction, context, childId);
      const grants = await transaction.consentGrant.findMany({
        where: {
          organizationId: context.organizationId,
          childId,
          status: { in: statuses },
        },
        include: { scopes: true },
        orderBy: { createdAt: 'desc' },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'consent.listed',
          entityType: 'child',
          entityId: childId,
          purpose: context.purpose,
        },
      });
      return grants;
    });
  }

  async function withdrawConsent(context, consentId, input) {
    const reason = requiredText(input.reason, 'reason', 500);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const grant = await transaction.consentGrant.findFirst({
        where: { id: consentId, organizationId: context.organizationId },
        include: { caregiver: { select: { subjectId: true } } },
      });
      if (!grant) throw new DomainError(404, 'CONSENT_NOT_FOUND', 'Consent grant not found');
      if (grant.status !== 'ACTIVE') {
        throw new DomainError(409, 'CONSENT_NOT_ACTIVE', 'Only active consent can be withdrawn');
      }
      const caregiverOwnsConsent = grant.caregiver.subjectId === context.actorSubjectId;
      if (!caregiverOwnsConsent && !WITHDRAWAL_ROLES.has(context.role)) {
        throw new DomainError(
          403,
          'CONSENT_WITHDRAWAL_DENIED',
          'Only the granting caregiver or an authorized administrator can withdraw consent'
        );
      }
      const consent = await transaction.consentGrant.update({
        where: { id: grant.id },
        data: {
          status: 'WITHDRAWN',
          withdrawnAt: new Date(),
          withdrawnBySubjectId: context.actorSubjectId,
          withdrawalReason: reason,
        },
        include: { scopes: true },
      });
      await Promise.all([
        transaction.auditEvent.create({
          data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'consent.withdrawn',
          entityType: 'consent',
          entityId: consent.id,
          purpose: context.purpose,
          metadata: { childId: consent.childId, reason },
          },
        }),
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
            aggregateType: 'blockchain-anchor',
            aggregateId: consent.id,
            idempotencyKey: `blockchain:2:${consent.id}`,
            payload: {
              eventCode: 0x02,
              anchorId: `consent-withdrawal:${consent.id}`,
              tenantId: context.organizationId,
            },
          },
        }),
      ]);
      return consent;
    });
  }

  async function evaluateDisclosure(context, childId, input) {
    const recipient = validateRecipient(input);
    const requestedScopes = normalizeScopes(input.scopes);
    const purpose = requiredText(input.purpose, 'purpose', 160);
    const now = new Date();

    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await requireActiveChild(transaction, context, childId);
      const grants = await transaction.consentGrant.findMany({
        where: {
          organizationId: context.organizationId,
          childId,
          status: 'ACTIVE',
          ...recipient,
          purpose,
          startsAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: { scopes: true },
      });
      const matchingGrant = grants.find((grant) => grantCoversScopes(grant, requestedScopes));
      const decision = matchingGrant ? 'ALLOWED' : 'DENIED';
      const reasonCode = matchingGrant ? 'ACTIVE_CONSENT' : 'NO_APPLICABLE_CONSENT';
      const disclosure = await transaction.disclosureEvent.create({
        data: {
          organizationId: context.organizationId,
          childId,
          actorSubjectId: context.actorSubjectId,
          ...recipient,
          purpose,
          requestedScopes,
          decision,
          reasonCode,
          ...(matchingGrant ? { consentGrantId: matchingGrant.id } : {}),
          ...(input.requestId
            ? { requestId: requiredText(input.requestId, 'requestId', 120) }
            : {}),
        },
      });
      return {
        allowed: decision === 'ALLOWED',
        reasonCode,
        consentGrantId: matchingGrant?.id || null,
        disclosureEventId: disclosure.id,
      };
    });
  }

  return {
    grantConsent,
    listConsents,
    withdrawConsent,
    evaluateDisclosure,
  };
}

module.exports = {
  createConsentService,
  grantCoversScopes,
  normalizeScopes,
  scopeAllows,
};
