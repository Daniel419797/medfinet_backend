const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createLocalizationAssistService,
  normalizeTranslation,
} = require('../services/ai/localizationAssistService');
const { createAiClient } = require('../services/ai/aiClient');

function startMockServer(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* not JSON */ }
      handler({ method: req.method, url: req.url, headers: req.headers, body: parsed }, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

const context = { organizationId: 'org-1', actorSubjectId: 'actor-1', purpose: 'CONTENT' };

function fakeLocalization(draftOverrides = {}) {
  return {
    createDraft: async (ctx, input) => ({
      id: 'content-1',
      organizationId: ctx.organizationId,
      status: 'DRAFT',
      version: 1,
      ...draftOverrides,
      ...input,
    }),
  };
}

test('normalizeTranslation validates locales and content', () => {
  assert.throws(() => normalizeTranslation({}), (error) => error.code === 'VALIDATION_ERROR');
  assert.throws(
    () => normalizeTranslation({ contentKey: 'a', value: 'hello', targetLocale: 'fr' }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.throws(
    () => normalizeTranslation({ contentKey: 'a', value: 'x'.repeat(4001), targetLocale: 'ha' }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  const normalized = normalizeTranslation({
    contentKey: 'ussd.greeting',
    value: 'Hello',
    sourceLocale: 'english',
    targetLocale: 'hausa',
  });
  assert.equal(normalized.sourceLocale, 'en');
  assert.equal(normalized.targetLocale, 'ha');
});

test('generate creates a draft with source text when AI disabled', async () => {
  const service = createLocalizationAssistService(null, {
    ai: createAiClient({ provider: 'disabled' }),
    localization: fakeLocalization(),
  });
  const result = await service.generate(context, {
    contentKey: 'ussd.greeting',
    value: 'Welcome to Medfinet',
    targetLocale: 'ha',
  });
  assert.equal(result.source, 'rules');
  assert.equal(result.model, null);
  assert.equal(result.content.locale, 'ha');
  assert.equal(result.content.value, 'Welcome to Medfinet');
  assert.equal(result.content.status, 'DRAFT');
});

test('generate rejects same source and target locale', async () => {
  const service = createLocalizationAssistService(null, {
    ai: createAiClient({ provider: 'disabled' }),
    localization: fakeLocalization(),
  });
  await assert.rejects(
    () => service.generate(context, {
      contentKey: 'ussd.greeting',
      value: 'Welcome',
      targetLocale: 'en',
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('generate uses AI translation when enabled', async () => {
  const { server, port } = await startMockServer((request, res) => {
    assert.match(request.body.messages[0].content, /translate/i);
    assert.match(request.body.messages[1].content, /Welcome to Medfinet/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            value: 'Barka da zuwa Medfinet',
            translatorNote: 'Verified by review.',
          }),
        },
      }],
    }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    });
    const service = createLocalizationAssistService(null, {
      ai,
      localization: fakeLocalization(),
    });
    const result = await service.generate(context, {
      contentKey: 'ussd.greeting',
      value: 'Welcome to Medfinet',
      targetLocale: 'ha',
    });
    assert.equal(result.source, 'ai');
    assert.equal(result.content.value, 'Barka da zuwa Medfinet');
    assert.equal(result.content.locale, 'ha');
  } finally {
    server.close();
  }
});

test('generate falls back on provider failure with explicit note', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: { message: 'down' } }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    });
    const service = createLocalizationAssistService(null, {
      ai,
      localization: fakeLocalization(),
    });
    const result = await service.generate(context, {
      contentKey: 'ussd.greeting',
      value: 'Welcome to Medfinet',
      targetLocale: 'yo',
    });
    assert.equal(result.source, 'rules');
    assert.equal(result.content.value, 'Welcome to Medfinet');
    assert.match(result.content.translatorNote, /Machine translation unavailable/);
  } finally {
    server.close();
  }
});
