const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { createUssdIdentityService } = require('./ussdIdentityService');
const { createUssdFacilityService } = require('./ussdFacilityService');
const { USSD_CONSENT_CATEGORIES } = require('./ussdHighRiskWorkflowService');

function createUssdAdminService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const identity = createUssdIdentityService(database);
  const facilities = createUssdFacilityService(database);

  async function configureAccess(context, caregiverId, input) {
    return identity.setupAccess(context, caregiverId, input);
  }

  async function publishFacility(context, facilityId) {
    return facilities.publish(context, facilityId);
  }

  async function createConsentRequest(context, input) {
    const scopes = input.requestedScopes;
    const expiresAt = new Date(input.expiresAt);
    const required = ['recipientId', 'recipientDisplayName', 'purpose', 'legalBasis', 'policyVersion'];
    if (required.some((field) => !String(input[field] || '').trim())) {
      throw new DomainError(400, 'USSD_CONSENT_DETAILS_REQUIRED', 'Recipient, purpose, legal basis, and policy version are required');
    }
    if (!['ORGANIZATION', 'PROGRAMME', 'PARTNER', 'RESEARCH'].includes(input.recipientType)) {
      throw new DomainError(400, 'USSD_CONSENT_RECIPIENT_INVALID', 'Consent recipient type is invalid');
    }
    if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 4
      || scopes.some((scope) => !USSD_CONSENT_CATEGORIES.has(scope?.category) || scope?.access !== 'READ')) {
      throw new DomainError(400, 'USSD_CONSENT_SCOPE_UNSAFE', 'Only 1-4 approved read scopes are allowed');
    }
    if (Number.isNaN(expiresAt.valueOf()) || expiresAt <= new Date()
      || expiresAt > new Date(Date.now() + 24 * 60 * 60 * 1000)) {
      throw new DomainError(400, 'USSD_CONSENT_EXPIRY_INVALID', 'Consent request must expire within 24 hours');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const link = await transaction.childCaregiver.findFirst({
        where: {
          organizationId: context.organizationId,
          childId: input.childId,
          caregiverId: input.caregiverId,
          hasConsentAuthority: true,
          caregiver: { phoneVerifiedAt: { not: null }, ussdPinHash: { not: null } },
        },
      });
      if (!link) throw new DomainError(409, 'USSD_CONSENT_CAREGIVER_INELIGIBLE', 'Eligible caregiver authority was not found');
      const request = await transaction.ussdConsentRequest.create({
        data: {
          organizationId: context.organizationId,
          caregiverId: input.caregiverId,
          childId: input.childId,
          recipientType: input.recipientType,
          recipientId: String(input.recipientId || '').slice(0, 160),
          recipientDisplayName: String(input.recipientDisplayName || '').slice(0, 100),
          purpose: String(input.purpose || '').slice(0, 160),
          legalBasis: String(input.legalBasis || '').slice(0, 100),
          policyVersion: String(input.policyVersion || '').slice(0, 40),
          requestedScopes: scopes,
          expiresAt,
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({ data: {
        organizationId: context.organizationId,
        actorSubjectId: context.actorSubjectId,
        action: 'ussd.consent-request-created',
        entityType: 'ussd-consent-request',
        entityId: request.id,
        purpose: context.purpose,
        metadata: { categories: scopes.map((scope) => scope.category) },
      } });
      return request;
    });
  }

  async function listQueue(context, type, status = 'PENDING') {
    const definitions = {
      appointments: ['appointmentCaregiverResponse', { createdAt: 'asc' }],
      callbacks: ['ussdCallbackRequest', [{ priority: 'desc' }, { createdAt: 'asc' }]],
      cards: ['nfcCardSupportRequest', { createdAt: 'asc' }],
      programmes: ['programmeInterest', { createdAt: 'asc' }],
      deliveries: ['serviceDeliveryConfirmation', { createdAt: 'asc' }],
      climate: ['climateAssistanceRequest', [{ priority: 'desc' }, { createdAt: 'asc' }]],
    };
    const definition = definitions[type];
    if (!definition) throw new DomainError(400, 'USSD_QUEUE_INVALID', 'Queue type is invalid');
    if (!['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      throw new DomainError(400, 'USSD_QUEUE_STATUS_INVALID', 'Queue status is invalid');
    }
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction[definition[0]].findMany({
        where: { organizationId: context.organizationId, status },
        orderBy: definition[1],
        take: 100,
      })
    ));
  }

  async function reviewQueueItem(context, type, id, input) {
    const status = input.status;
    const definitions = {
      appointments: ['appointmentCaregiverResponse', true, ['APPROVED', 'REJECTED', 'CANCELLED']],
      callbacks: ['ussdCallbackRequest', false, ['COMPLETED', 'CANCELLED']],
      cards: ['nfcCardSupportRequest', true, ['APPROVED', 'REJECTED', 'CANCELLED']],
      programmes: ['programmeInterest', true, ['APPROVED', 'REJECTED', 'CANCELLED']],
      deliveries: ['serviceDeliveryConfirmation', true, ['APPROVED', 'REJECTED', 'COMPLETED']],
      climate: ['climateAssistanceRequest', false, ['COMPLETED', 'CANCELLED']],
    };
    const definition = definitions[type];
    if (!definition) throw new DomainError(400, 'USSD_QUEUE_INVALID', 'Queue type is invalid');
    if (!definition[2].includes(status)) {
      throw new DomainError(400, 'USSD_REVIEW_STATUS_INVALID', 'Review status is invalid for this queue');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const model = transaction[definition[0]];
      const existing = await model.findFirst({
        where: { id, organizationId: context.organizationId, status: 'PENDING' },
      });
      if (!existing) throw new DomainError(404, 'USSD_QUEUE_ITEM_NOT_FOUND', 'Pending queue item was not found');
      const data = { status };
      if (definition[1]) {
        data.reviewedBySubjectId = context.actorSubjectId;
        data.reviewedAt = new Date();
      }
      if (type === 'appointments' && input.notes) data.reviewNotes = String(input.notes).slice(0, 500);
      if (type === 'callbacks' && ['COMPLETED', 'CANCELLED'].includes(status)) {
        data.resolvedBySubjectId = context.actorSubjectId;
        data.resolvedAt = new Date();
        if (input.notes) data.resolutionNotes = String(input.notes).slice(0, 500);
      }
      if (type === 'climate' && ['COMPLETED', 'CANCELLED'].includes(status)) data.resolvedAt = new Date();
      const updated = await model.update({ where: { id }, data });
      await transaction.auditEvent.create({ data: {
        organizationId: context.organizationId,
        actorSubjectId: context.actorSubjectId,
        action: 'ussd.queue-item-reviewed',
        entityType: definition[0],
        entityId: id,
        purpose: context.purpose,
        metadata: { status, type },
      } });
      return updated;
    });
  }

  return { configureAccess, createConsentRequest, listQueue, publishFacility, reviewQueueItem };
}

module.exports = { createUssdAdminService };
