const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createUssdIntakeService,
  keywordIntent,
  rulesIntake,
  normalizeIntake,
} = require('../services/ai/ussdIntakeService');
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

test('keywordIntent classifies free text', () => {
  assert.equal(keywordIntent('my baby is not breathing'), 'EMERGENCY');
  assert.equal(keywordIntent('when is the next vaccination'), 'VACCINATION');
  assert.equal(keywordIntent('my card is lost'), 'CARD_HELP');
  assert.equal(keywordIntent('where is the nearest clinic'), 'CLINIC');
  assert.equal(keywordIntent('shigar da allurar rigakafin'), 'VACCINATION');
  assert.equal(keywordIntent('hello world nothing here'), 'OTHER');
  assert.equal(keywordIntent(''), 'OTHER');
});

test('rulesIntake marks emergencies urgent', () => {
  const result = rulesIntake('the baby is unconscious and bleeding', 'en');
  assert.equal(result.intent, 'EMERGENCY');
  assert.equal(result.urgent, true);
});

test('normalizeIntake caps length and validates', () => {
  assert.throws(() => normalizeIntake({}), (error) => error.code === 'VALIDATION_ERROR');
  assert.throws(
    () => normalizeIntake({ text: 'x'.repeat(501) }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.equal(normalizeIntake({ text: 'hi', locale: 'ha' }).locale, 'ha');
  assert.equal(normalizeIntake({ text: 'hi', locale: 'fr' }).locale, 'en');
});

test('intake service falls back to rules when AI is disabled', async () => {
  const service = createUssdIntakeService({ ai: createAiClient({ provider: 'disabled' }) });
  const result = await service.parse({}, { text: 'baby has fever and diarrhea' });
  assert.equal(result.source, 'rules');
  assert.equal(result.intent, 'CLINIC');
  assert.equal(result.model, null);
});

test('intake service uses AI classification when enabled', async () => {
  const { server, port } = await startMockServer((request, res) => {
    assert.match(request.body.messages[1].content, /fever/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            intent: 'EMERGENCY',
            urgent: true,
            summary: 'Baby has high fever',
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
    const service = createUssdIntakeService({ ai });
    const result = await service.parse({}, { text: 'my baby has high fever' });
    assert.equal(result.source, 'ai');
    assert.equal(result.intent, 'EMERGENCY');
    assert.equal(result.urgent, true);
    assert.equal(result.summary, 'Baby has high fever');
  } finally {
    server.close();
  }
});

test('intake service coerces unknown AI intents to OTHER', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ intent: 'DANCE', urgent: false, summary: 'x' }),
        },
      }],
    }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    });
    const service = createUssdIntakeService({ ai });
    const result = await service.parse({}, { text: 'dancing today' });
    assert.equal(result.intent, 'OTHER');
  } finally {
    server.close();
  }
});

test('intake service falls back on provider failure', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: { message: 'boom' } }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    });
    const service = createUssdIntakeService({ ai });
    const result = await service.parse({}, { text: 'emergency help now' });
    assert.equal(result.source, 'rules');
    assert.equal(result.intent, 'EMERGENCY');
  } finally {
    server.close();
  }
});
