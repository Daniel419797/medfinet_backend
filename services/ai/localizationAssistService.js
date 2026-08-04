const { DomainError } = require('../../utils/domainError');
const { createLocalizationService, normalizeLocale } = require('../localizationService');

const MAX_SOURCE_LENGTH = 4000;

function normalizeTranslation(input) {
  const contentKey = String(input.contentKey || '').trim();
  if (!contentKey || contentKey.length > 160) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'contentKey is invalid');
  }
  const value = String(input.value || '').trim();
  if (!value || value.length > MAX_SOURCE_LENGTH) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'value is invalid');
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'value contains unsafe control characters');
  }
  return {
    contentKey,
    value,
    sourceLocale: normalizeLocale(input.sourceLocale || 'en', 'sourceLocale'),
    targetLocale: normalizeLocale(input.targetLocale, 'targetLocale'),
  };
}

function createLocalizationAssistService(prismaClient, options = {}) {
  const database = prismaClient || require('../../utils/prisma').prisma;
  const ai = options.ai || (() => {
    const config = require('../../config');
    const { createAiClient } = require('./aiClient');
    return config.ai.enabled ? createAiClient(config.ai) : createAiClient({ provider: 'disabled' });
  })();
  const localization = options.localization || createLocalizationService(database);

  async function generate(context, input) {
    const normalized = normalizeTranslation(input);
    if (normalized.sourceLocale === normalized.targetLocale) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'sourceLocale and targetLocale must differ'
      );
    }

    let translated;
    if (ai.enabled) {
      const fallback = () => ({
        value: normalized.value,
        translatorNote: 'Machine translation unavailable; draft created with source text.',
      });
      const { value: parsed, fellBack } = await ai.completeJson({
        system: [
          'You are a professional translator for health programme materials (Medfinet).',
          `Translate the message from ${normalized.sourceLocale} to ${normalized.targetLocale}.`,
          'Use simple, culturally appropriate language for low-literacy caregivers.',
          'Keep placeholders like {name} or {date} unchanged.',
          'The translatorNote must be one short sentence (or empty).',
        ].join('\n'),
        user: `Message (${normalized.sourceLocale}):\n${normalized.value}`,
        schema: { value: 'string', translatorNote: 'string' },
        fallback,
        maxTokens: 1000,
      });
      translated = {
        value: parsed.value,
        translatorNote: fellBack
          ? (parsed.translatorNote || 'Machine translation unavailable; draft created with source text.')
          : (parsed.translatorNote || null),
        model: fellBack ? null : ai.model,
        source: fellBack ? 'rules' : 'ai',
      };
    } else {
      translated = {
        value: normalized.value,
        translatorNote: 'Machine translation unavailable; draft created with source text.',
        model: null,
        source: 'rules',
      };
    }

    const draft = await localization.createDraft(context, {
      contentKey: normalized.contentKey,
      value: translated.value,
      locale: normalized.targetLocale,
      translatorNote: translated.translatorNote,
    });
    return {
      source: translated.source,
      model: translated.model,
      content: draft,
    };
  }

  return { generate };
}

module.exports = {
  createLocalizationAssistService,
  normalizeTranslation,
  MAX_SOURCE_LENGTH,
};