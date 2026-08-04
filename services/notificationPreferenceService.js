const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { CHANNELS, locale } = require('./notificationTemplateService');

function hour(value, field) {
  if (value === null || value === undefined) return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 23) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} must be between 0 and 23`);
  }
  return normalized;
}

function timezone(value) {
  const normalized = requiredText(value || 'Africa/Lagos', 'timezone', 80);
  try {
    new Intl.DateTimeFormat('en', { timeZone: normalized }).format(new Date());
  } catch {
    throw new DomainError(400, 'VALIDATION_ERROR', 'timezone is invalid');
  }
  return normalized;
}

function canManage(context, subjectId) {
  return (
    context.actorSubjectId === subjectId
    || ['OWNER', 'ADMIN'].includes(context.role)
  );
}

function createNotificationPreferenceService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function upsert(context, input) {
    const subjectId = requiredText(
      input.subjectId || context.actorSubjectId,
      'subjectId',
      160
    );
    if (!canManage(context, subjectId)) {
      throw new DomainError(
        403,
        'NOTIFICATION_PREFERENCE_ACCESS_DENIED',
        'Notification preferences can only be changed by their owner'
      );
    }
    if (!CHANNELS.has(input.channel)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'channel is unsupported');
    }
    const category = requiredText(input.category, 'category', 80).toUpperCase();
    const quietHoursStart = hour(input.quietHoursStart, 'quietHoursStart');
    const quietHoursEnd = hour(input.quietHoursEnd, 'quietHoursEnd');
    if ((quietHoursStart === null) !== (quietHoursEnd === null)) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'Both quiet hour values must be provided together'
      );
    }
    if (quietHoursStart === quietHoursEnd && quietHoursStart !== null) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'Quiet hours cannot cover zero hours');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const membership = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_subjectId: {
            organizationId: context.organizationId,
            subjectId,
          },
        },
      });
      if (!membership || membership.status !== 'ACTIVE') {
        throw new DomainError(404, 'ACTIVE_SUBJECT_NOT_FOUND', 'Active subject not found');
      }
      const preference = await transaction.notificationPreference.upsert({
        where: {
          organizationId_subjectId_category_channel: {
            organizationId: context.organizationId,
            subjectId,
            category,
            channel: input.channel,
          },
        },
        create: {
          organizationId: context.organizationId,
          subjectId,
          category,
          channel: input.channel,
          enabled: input.enabled !== false,
          locale: locale(input.locale || 'en'),
          timezone: timezone(input.timezone),
          quietHoursStart,
          quietHoursEnd,
        },
        update: {
          enabled: input.enabled !== false,
          locale: locale(input.locale || 'en'),
          timezone: timezone(input.timezone),
          quietHoursStart,
          quietHoursEnd,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'notification-preference.updated',
          entityType: 'notification-preference',
          entityId: preference.id,
          purpose: context.purpose,
          metadata: {
            subjectId,
            category,
            channel: input.channel,
            enabled: preference.enabled,
          },
        },
      });
      return preference;
    });
  }

  async function list(context, subjectId = context.actorSubjectId) {
    if (!canManage(context, subjectId)) {
      throw new DomainError(
        403,
        'NOTIFICATION_PREFERENCE_ACCESS_DENIED',
        'Notification preferences can only be read by their owner'
      );
    }
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.notificationPreference.findMany({
        where: { organizationId: context.organizationId, subjectId },
        orderBy: [{ category: 'asc' }, { channel: 'asc' }],
      })
    ));
  }

  return { upsert, list };
}

module.exports = {
  createNotificationPreferenceService,
  hour,
  timezone,
  canManage,
};
