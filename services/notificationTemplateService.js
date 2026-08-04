const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { normalizeLocale } = require('./localizationService');

const CHANNELS = new Set(['IN_APP', 'EMAIL', 'SMS', 'PUSH']);
const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

function locale(value) {
  return normalizeLocale(value);
}

function variableNames(values) {
  if (!Array.isArray(values) || values.length > 30) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'variableNames must be an array with at most 30 values'
    );
  }
  const normalized = values.map((value) => {
    const name = requiredText(value, 'variableName', 60);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'variableName is invalid');
    }
    return name;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'variableNames must be unique');
  }
  return normalized;
}

function templatePlaceholders(subject, body) {
  const source = `${subject || ''}\n${body}`;
  return [...source.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

function assertTemplateContract(subject, body, names) {
  const placeholders = new Set(templatePlaceholders(subject, body));
  const declared = new Set(names);
  if (
    placeholders.size !== declared.size
    || [...placeholders].some((name) => !declared.has(name))
  ) {
    throw new DomainError(
      400,
      'NOTIFICATION_TEMPLATE_CONTRACT_INVALID',
      'Template placeholders must exactly match variableNames'
    );
  }
}

function createNotificationTemplateService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function createTemplate(context, input) {
    const channel = input.channel;
    if (!CHANNELS.has(channel)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'channel is unsupported');
    }
    const subject = input.subject
      ? requiredText(input.subject, 'subject', 240)
      : null;
    if (channel === 'EMAIL' && !subject) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'Email templates require a subject');
    }
    const body = requiredText(input.body, 'body', 10_000);
    const names = variableNames(input.variableNames);
    assertTemplateContract(subject, body, names);
    const version = Number(input.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'version must be a positive integer');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const template = await transaction.notificationTemplate.create({
        data: {
          organizationId: context.organizationId,
          key: requiredText(input.key, 'key', 100).toUpperCase(),
          version,
          locale: locale(input.locale),
          channel,
          subject,
          body,
          variableNames: names,
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'notification-template.created',
          entityType: 'notification-template',
          entityId: template.id,
          purpose: context.purpose,
        },
      });
      return template;
    });
  }

  async function activateTemplate(context, templateId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.notificationTemplate.findFirst({
        where: {
          id: templateId,
          organizationId: context.organizationId,
          status: 'DRAFT',
        },
      });
      if (!existing) {
        throw new DomainError(404, 'DRAFT_TEMPLATE_NOT_FOUND', 'Draft template not found');
      }
      const activatedAt = now();
      await transaction.notificationTemplate.updateMany({
        where: {
          organizationId: context.organizationId,
          key: existing.key,
          locale: existing.locale,
          channel: existing.channel,
          status: 'ACTIVE',
        },
        data: { status: 'RETIRED', retiredAt: activatedAt },
      });
      const template = await transaction.notificationTemplate.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          activatedBySubjectId: context.actorSubjectId,
          activatedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'notification-template.activated',
          entityType: 'notification-template',
          entityId: template.id,
          purpose: context.purpose,
          metadata: { key: template.key, version: template.version },
        },
      });
      return template;
    });
  }

  async function listTemplates(context, input = {}) {
    const limit = input.limit === undefined ? 25 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const items = await transaction.notificationTemplate.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.key ? { key: String(input.key).toUpperCase() } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const hasMore = items.length > limit;
      const templates = hasMore ? items.slice(0, limit) : items;
      return {
        items: templates,
        nextCursor: hasMore ? templates[templates.length - 1].id : null,
      };
    });
  }

  return { createTemplate, activateTemplate, listTemplates };
}

module.exports = {
  createNotificationTemplateService,
  locale,
  variableNames,
  templatePlaceholders,
  assertTemplateContract,
  CHANNELS,
};
