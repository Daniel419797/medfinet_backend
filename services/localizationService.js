const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

const SUPPORTED_LOCALES = Object.freeze([
  { code: 'en', name: 'English', direction: 'ltr' },
  { code: 'ha', name: 'Hausa', direction: 'ltr' },
  { code: 'yo', name: 'Yoruba', direction: 'ltr' },
  { code: 'ig', name: 'Igbo', direction: 'ltr' },
]);
const LOCALE_CODES = new Set(SUPPORTED_LOCALES.map(({ code }) => code));
const LOCALE_ALIASES = new Map([
  ['en', 'en'],
  ['english', 'en'],
  ['ha', 'ha'],
  ['hausa', 'ha'],
  ['yo', 'yo'],
  ['yoruba', 'yo'],
  ['ig', 'ig'],
  ['igbo', 'ig'],
]);
const CONTENT_KEY = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){1,7}$/;

function text(value, field, maximum, optional = false) {
  if ((value === undefined || value === null || value === '') && optional) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} is required`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} is invalid`);
  }
  return normalized;
}

function normalizeLocale(value, field = 'locale') {
  if (typeof value !== 'string') {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} is unsupported`);
  }
  const locale = LOCALE_ALIASES.get(value.trim().toLowerCase());
  if (!locale) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} is unsupported`);
  }
  return locale;
}

function normalizeContent(input) {
  const contentKey = text(input.contentKey, 'contentKey', 160);
  if (!CONTENT_KEY.test(contentKey)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'contentKey is invalid');
  }
  const value = text(input.value, 'value', 4000);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'value contains unsafe control characters'
    );
  }
  return {
    contentKey,
    locale: normalizeLocale(input.locale),
    value,
    translatorNote: text(
      input.translatorNote,
      'translatorNote',
      1000,
      true
    ),
  };
}

function createLocalizationService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function createDraft(context, input) {
    const normalized = normalizeContent(input);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const latest = await transaction.localizationContent.findFirst({
        where: {
          organizationId: context.organizationId,
          contentKey: normalized.contentKey,
          locale: normalized.locale,
        },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const content = await transaction.localizationContent.create({
        data: {
          organizationId: context.organizationId,
          ...normalized,
          version: (latest?.version || 0) + 1,
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'localization-content.created',
          entityType: 'localization-content',
          entityId: content.id,
          purpose: context.purpose,
          metadata: {
            contentKey: content.contentKey,
            locale: content.locale,
            version: content.version,
          },
        },
      });
      return content;
    });
  }

  async function listContent(context, input = {}) {
    const limit = input.limit === undefined ? 100 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 200');
    }
    const requestedLocale = input.locale ? normalizeLocale(input.locale) : null;
    const allowedStatuses = new Set(['DRAFT', 'ACTIVE', 'RETIRED']);
    if (input.status && !allowedStatuses.has(input.status)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'status is unsupported');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.localizationContent.findMany({
        where: {
          organizationId: context.organizationId,
          ...(requestedLocale ? { locale: requestedLocale } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        select: {
          id: true,
          contentKey: true,
          locale: true,
          value: true,
          translatorNote: true,
          version: true,
          status: true,
          createdBySubjectId: true,
          approvedBySubjectId: true,
          approvedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ contentKey: 'asc' }, { locale: 'asc' }, { version: 'desc' }],
        take: limit,
      });
      return { items: rows };
    });
  }

  async function activate(context, contentId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const draft = await transaction.localizationContent.findFirst({
        where: {
          id: contentId,
          organizationId: context.organizationId,
          status: 'DRAFT',
        },
      });
      if (!draft) {
        throw new DomainError(
          404,
          'DRAFT_LOCALIZATION_CONTENT_NOT_FOUND',
          'Draft localization content not found'
        );
      }
      if (draft.createdBySubjectId === context.actorSubjectId) {
        throw new DomainError(
          409,
          'LOCALIZATION_MAKER_CHECKER_REQUIRED',
          'A different administrator must approve translated content'
        );
      }
      const approvedAt = new Date();
      await transaction.localizationContent.updateMany({
        where: {
          organizationId: context.organizationId,
          contentKey: draft.contentKey,
          locale: draft.locale,
          status: 'ACTIVE',
        },
        data: { status: 'RETIRED' },
      });
      const active = await transaction.localizationContent.update({
        where: { id: draft.id },
        data: {
          status: 'ACTIVE',
          approvedBySubjectId: context.actorSubjectId,
          approvedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'localization-content.activated',
          entityType: 'localization-content',
          entityId: active.id,
          purpose: context.purpose,
          metadata: {
            contentKey: active.contentKey,
            locale: active.locale,
            version: active.version,
          },
        },
      });
      return active;
    });
  }

  async function catalog(context, requestedLocale) {
    const locale = normalizeLocale(requestedLocale || 'en');
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.localizationContent.findMany({
        where: {
          organizationId: context.organizationId,
          status: 'ACTIVE',
          locale: { in: locale === 'en' ? ['en'] : ['en', locale] },
        },
        select: {
          contentKey: true,
          locale: true,
          value: true,
          version: true,
          approvedAt: true,
        },
        orderBy: [
          { contentKey: 'asc' },
          { locale: 'asc' },
        ],
      });
      const messages = {};
      const versions = {};
      for (const row of rows) {
        if (!messages[row.contentKey] || row.locale === locale) {
          messages[row.contentKey] = row.value;
          versions[row.contentKey] = {
            locale: row.locale,
            version: row.version,
            approvedAt: row.approvedAt,
          };
        }
      }
      return {
        locale,
        fallbackLocale: 'en',
        messages,
        versions,
      };
    });
  }

  function supported() {
    return { defaultLocale: 'en', locales: SUPPORTED_LOCALES };
  }

  return { createDraft, listContent, activate, catalog, supported };
}

module.exports = {
  createLocalizationService,
  normalizeLocale,
  normalizeContent,
  SUPPORTED_LOCALES,
  LOCALE_CODES,
};
