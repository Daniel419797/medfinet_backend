const { DomainError } = require('../../utils/domainError');
const { createHttpClient } = require('./httpClient');

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.2;

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function detectProvider(options) {
  if (options.provider === 'disabled' || !options.apiKey) return 'disabled';
  if (options.provider) {
    if (['openai', 'anthropic'].includes(options.provider)) return options.provider;
    throw new DomainError(400, 'VALIDATION_ERROR', `Unsupported AI_PROVIDER: ${options.provider}`);
  }
  if (options.baseUrl) return 'openai';
  if (/^claude/i.test(options.model || '')) return 'anthropic';
  return 'openai';
}

function openAiProvider(http, { baseUrl, model, apiKey, system, user, temperature, maxTokens }) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  return http.postJson(
    `${stripTrailingSlash(baseUrl)}/chat/completions`,
    { authorization: `Bearer ${apiKey}` },
    { model, messages, temperature, max_tokens: maxTokens }
  ).then((data) => {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new DomainError(502, 'AI_EMPTY_RESPONSE', 'AI provider returned an empty response');
    }
    return { text: content.trim(), model: data.model || model };
  });
}

function anthropicProvider(http, { baseUrl, model, apiKey, system, user, temperature, maxTokens }) {
  return http.postJson(
    `${stripTrailingSlash(baseUrl)}/v1/messages`,
    {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model,
      system,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: user }],
    }
  ).then((data) => {
    const content = data?.content?.find((part) => part.type === 'text')?.text;
    if (typeof content !== 'string' || !content.trim()) {
      throw new DomainError(502, 'AI_EMPTY_RESPONSE', 'AI provider returned an empty response');
    }
    return { text: content.trim(), model: data.model || model };
  });
}

function stripFences(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return trimmed;
}

function createAiClient(config = {}) {
  const provider = detectProvider({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  if (provider !== 'disabled' && !config.baseUrl) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'An AI base URL is required; configure AI_BASE_URL'
    );
  }
  const baseUrl = config.baseUrl ? stripTrailingSlash(config.baseUrl) : '';
  const model = config.model || DEFAULT_MODEL;
  const maxTokens = config.maxTokens || DEFAULT_MAX_TOKENS;
  const temperature = config.temperature === undefined
    ? DEFAULT_TEMPERATURE
    : config.temperature;
  const http = createHttpClient({ timeoutMs: config.timeoutMs });

  function callProvider({ system, user, overrides = {} }) {
    const prompt = { system, user };
    if (provider === 'disabled') {
      throw new DomainError(503, 'AI_DISABLED', 'AI is not configured on this server');
    }
    if (provider === 'anthropic') {
      return anthropicProvider(http, {
        baseUrl,
        model,
        apiKey: config.apiKey,
        temperature: overrides.temperature ?? temperature,
        maxTokens: overrides.maxTokens ?? maxTokens,
        ...prompt,
      });
    }
    return openAiProvider(http, {
      baseUrl,
      model,
      apiKey: config.apiKey,
      temperature: overrides.temperature ?? temperature,
      maxTokens: overrides.maxTokens ?? maxTokens,
      ...prompt,
    });
  }

  async function complete({ system, user, temperature: overriddenTemperature, maxTokens: overriddenMaxTokens }) {
    const result = await callProvider({
      system,
      user,
      overrides: {
        temperature: overriddenTemperature,
        maxTokens: overriddenMaxTokens,
      },
    });
    return {
      text: result.text,
      provider,
      model: result.model,
    };
  }

  async function completeJson({
    system,
    user,
    schema,
    fallback,
    temperature,
    maxTokens,
  }) {
    let parsed;
    let fellBack = false;
    try {
      const result = await complete({
        system: `${system}\n\nRespond with strictly valid JSON that matches this shape:\n${JSON.stringify(schema, null, 2)}\n\nReturn only the JSON object. No commentary, no markdown fences.`,
        user,
        temperature,
        maxTokens,
      });
      parsed = JSON.parse(stripFences(result.text));
    } catch (error) {
      if (error instanceof DomainError && ['AI_DISABLED', 'AI_TIMEOUT', 'AI_RATE_LIMITED', 'AI_PROVIDER_UNREACHABLE', 'AI_PROVIDER_UNAVAILABLE', 'AI_AUTHENTICATION_FAILED', 'AI_CREDITS_EXHAUSTED'].includes(error.code)) {
        if (typeof fallback === 'function') {
          fellBack = true;
          return { value: fallback(), fellBack };
        }
        throw error;
      }
      if (typeof fallback === 'function') {
        fellBack = true;
        return { value: fallback(), fellBack };
      }
      throw error;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      if (typeof fallback === 'function') {
        fellBack = true;
        return { value: fallback(), fellBack };
      }
      throw new DomainError(502, 'AI_INVALID_JSON', 'AI provider returned invalid JSON');
    }
    return { value: parsed, fellBack };
  }

  return Object.freeze({
    enabled: provider !== 'disabled',
    provider,
    model,
    complete,
    completeJson,
  });
}

module.exports = { createAiClient, stripFences, detectProvider };