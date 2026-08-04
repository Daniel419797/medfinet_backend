const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const {
  createNotificationEventResolver,
} = require('./notificationEventResolver');

function safeVariable(value, name) {
  if (!['string', 'number', 'bigint', 'boolean'].includes(typeof value)) {
    throw new DomainError(
      400,
      'NOTIFICATION_VARIABLE_INVALID',
      `${name} must be a scalar value`
    );
  }
  const normalized = String(value);
  if (normalized.length > 500) {
    throw new DomainError(
      400,
      'NOTIFICATION_VARIABLE_INVALID',
      `${name} exceeds 500 characters`
    );
  }
  return normalized;
}

function escapeContent(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderTemplate(template, variables) {
  const names = template.variableNames;
  if (!Array.isArray(names)) {
    throw new DomainError(
      500,
      'NOTIFICATION_TEMPLATE_INVALID',
      'Template variable contract is invalid'
    );
  }
  const supplied = Object.keys(variables).sort();
  const expected = [...names].sort();
  if (
    supplied.length !== expected.length
    || supplied.some((name, index) => name !== expected[index])
  ) {
    throw new DomainError(
      500,
      'NOTIFICATION_VARIABLE_CONTRACT_MISMATCH',
      'Notification variables do not match the active template'
    );
  }
  const normalized = Object.fromEntries(
    names.map((name) => [name, escapeContent(safeVariable(variables[name], name))])
  );
  const substitute = (source) => source?.replace(
    /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g,
    (_match, name) => normalized[name]
  ) || null;
  return {
    variables: normalized,
    subject: substitute(template.subject),
    body: substitute(template.body),
  };
}

function localHour(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Number(parts.find(({ type }) => type === 'hour').value);
}

function isQuiet(hour, start, end) {
  if (start === null || start === undefined) return false;
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

function scheduleOutsideQuietHours(currentTime, preference) {
  if (
    !isQuiet(
      localHour(currentTime, preference.timezone),
      preference.quietHoursStart,
      preference.quietHoursEnd
    )
  ) {
    return currentTime;
  }
  for (let offset = 1; offset <= 24; offset += 1) {
    const candidate = new Date(currentTime.getTime() + offset * 60 * 60 * 1000);
    if (
      !isQuiet(
        localHour(candidate, preference.timezone),
        preference.quietHoursStart,
        preference.quietHoursEnd
      )
    ) {
      return candidate;
    }
  }
  return new Date(currentTime.getTime() + 24 * 60 * 60 * 1000);
}

function defaultPreference(subjectId) {
  return {
    subjectId,
    category: null,
    channel: 'IN_APP',
    enabled: true,
    locale: 'en',
    timezone: 'Africa/Lagos',
    quietHoursStart: null,
    quietHoursEnd: null,
  };
}

function createNotificationQueueService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const eventResolver = createNotificationEventResolver(database);

  async function queueRecipients(context, eventId, spec) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const queued = [];
      for (const recipient of spec.recipients) {
        const configured = await transaction.notificationPreference.findMany({
          where: {
            organizationId: context.organizationId,
            subjectId: recipient.subjectId,
            category: spec.category,
          },
        });
        const preferences = configured.length
          ? configured.filter(({ enabled }) => enabled)
          : [defaultPreference(recipient.subjectId)];
        for (const preference of preferences) {
          const idempotencyKey = [
            eventId,
            recipient.subjectId,
            preference.channel,
          ].join(':');
          const replay = await transaction.notificationMessage.findUnique({
            where: {
              organizationId_idempotencyKey: {
                organizationId: context.organizationId,
                idempotencyKey,
              },
            },
          });
          if (replay) {
            queued.push(replay);
            continue;
          }
          const template = await transaction.notificationTemplate.findFirst({
            where: {
              organizationId: context.organizationId,
              key: spec.templateKey,
              locale: { in: [preference.locale, 'en'] },
              channel: preference.channel,
              status: 'ACTIVE',
            },
            orderBy: [{ locale: 'desc' }, { version: 'desc' }],
          });
          if (!template) {
            throw new DomainError(
              503,
              'ACTIVE_NOTIFICATION_TEMPLATE_UNAVAILABLE',
              `No active ${preference.channel} template exists for ${spec.templateKey}`
            );
          }
          const rendered = renderTemplate(template, spec.variables);
          const scheduledAt = scheduleOutsideQuietHours(now(), preference);
          const message = await transaction.notificationMessage.create({
            data: {
              organizationId: context.organizationId,
              recipientSubjectId: recipient.subjectId,
              ...(recipient.caregiverId
                ? { recipientCaregiverId: recipient.caregiverId }
                : {}),
              templateId: template.id,
              category: spec.category,
              channel: preference.channel,
              locale: template.locale,
              variables: rendered.variables,
              renderedSubject: rendered.subject,
              renderedBody: rendered.body,
              idempotencyKey,
              scheduledAt,
            },
          });
          await transaction.outboxEvent.create({
            data: {
              organizationId: context.organizationId,
              eventType: 'NOTIFICATION_DISPATCH_REQUESTED',
              aggregateType: 'notification-message',
              aggregateId: message.id,
              idempotencyKey: `notification:${message.id}:dispatch`,
              payload: { notificationMessageId: message.id },
              nextAttemptAt: scheduledAt,
            },
          });
          queued.push(message);
        }
      }
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'notification-event.queued',
          entityType: 'outbox-event',
          entityId: eventId,
          purpose: context.purpose,
          metadata: {
            templateKey: spec.templateKey,
            recipientCount: spec.recipients.length,
            messageCount: queued.length,
          },
        },
      });
      return queued;
    });
  }

  async function queueOutboxEvent(context, event) {
    const specification = await eventResolver.resolve(context, event);
    if (!specification || specification.recipients.length === 0) return [];
    return queueRecipients(context, event.id, specification);
  }

  return { queueRecipients, queueOutboxEvent };
}

module.exports = {
  createNotificationQueueService,
  renderTemplate,
  scheduleOutsideQuietHours,
  localHour,
  isQuiet,
};
