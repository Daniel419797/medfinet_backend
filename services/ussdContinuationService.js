const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { renderTemplate } = require('./notificationQueueService');

function scalar(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value.slice(0, 5).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value).slice(0, 7).map(([key, item]) => `${key}: ${item}`).join(', ');
  }
  return String(value);
}

function createUssdContinuationService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function queueFacilityDetails(context, facility, locale = 'en') {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const caregiver = await transaction.caregiver.findFirst({
        where: {
          id: context.caregiverId,
          organizationId: context.organizationId,
          phoneVerifiedAt: { not: null },
        },
        select: { id: true, subjectId: true, phoneNormalized: true },
      });
      if (!caregiver?.phoneNormalized) {
        throw new DomainError(409, 'USSD_SMS_PHONE_UNAVAILABLE', 'A verified phone is required');
      }
      const idempotencyKey = `ussd-facility:${context.sessionId}`;
      const replay = await transaction.notificationMessage.findUnique({
        where: { organizationId_idempotencyKey: {
          organizationId: context.organizationId, idempotencyKey,
        } },
      });
      if (replay) return replay;
      const template = await transaction.notificationTemplate.findFirst({
        where: {
          organizationId: context.organizationId,
          key: 'USSD_FACILITY_DETAILS',
          locale: { in: [locale, 'en'] },
          channel: 'SMS',
          status: 'ACTIVE',
        },
        orderBy: [{ locale: 'desc' }, { version: 'desc' }],
      });
      if (!template) {
        throw new DomainError(503, 'USSD_SMS_TEMPLATE_UNAVAILABLE', 'Facility SMS template is unavailable');
      }
      const rendered = renderTemplate(template, {
        facilityName: facility.facilityName || facility.name,
        address: facility.address || facility.administrativeArea || 'Unavailable',
        phone: facility.phone || 'Unavailable',
        openingHours: scalar(facility.openingHours, 'Unavailable'),
        programmes: scalar(facility.programmeCategories, 'Unavailable'),
      });
      const queued = await transaction.notificationMessage.create({
        data: {
          organizationId: context.organizationId,
          recipientSubjectId: caregiver.subjectId || `ussd-caregiver:${caregiver.id}`,
          recipientCaregiverId: caregiver.id,
          templateId: template.id,
          category: 'USSD_CONTINUATION',
          channel: 'SMS',
          locale: template.locale,
          variables: rendered.variables,
          renderedSubject: rendered.subject,
          renderedBody: rendered.body,
          idempotencyKey,
          scheduledAt: now(),
        },
      });
      await transaction.outboxEvent.create({ data: {
        organizationId: context.organizationId,
        eventType: 'NOTIFICATION_DISPATCH_REQUESTED',
        aggregateType: 'notification-message',
        aggregateId: queued.id,
        idempotencyKey: `notification:${queued.id}:dispatch`,
        payload: { notificationMessageId: queued.id },
      } });
      await transaction.auditEvent.create({ data: {
        organizationId: context.organizationId,
        actorSubjectId: `ussd:${context.sessionId}`,
        action: 'ussd.facility-details-sms-queued',
        entityType: 'notification-message',
        entityId: queued.id,
        purpose: 'caregiver-ussd-continuation',
      } });
      return queued;
    });
  }

  return { queueFacilityDetails };
}

module.exports = { createUssdContinuationService };
