const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createAiClient,
  detectProvider,
  stripFences,
} = require('../services/ai/aiClient');

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

test('detectProvider auto-detects provider', () => {
  assert.equal(detectProvider({}), 'disabled');
  assert.equal(detectProvider({ apiKey: 'k' }), 'openai');
  assert.equal(detectProvider({ apiKey: 'k', baseUrl: 'http://localhost:11434' }), 'openai');
  assert.equal(detectProvider({ apiKey: 'k', model: 'claude-3-5-haiku-latest' }), 'anthropic');
  assert.equal(detectProvider({ apiKey: 'k', provider: 'anthropic', model: 'gpt-4o' }), 'anthropic');
  assert.equal(detectProvider({ apiKey: 'k', provider: 'disabled' }), 'disabled');
  assert.throws(
    () => detectProvider({ apiKey: 'k', provider: 'garbage' }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('stripFences removes markdown code fences', () => {
  assert.equal(stripFences('{"a":1}'), '{"a":1}');
  assert.equal(stripFences('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripFences('```\n{"a":1}\n```'), '{"a":1}');
});

test('disabled client throws AI_DISABLED and completeJson uses fallback', async () => {
  const client = createAiClient({ provider: 'disabled' });
  assert.equal(client.enabled, false);
  await assert.rejects(
    () => client.complete({ system: 's', user: 'u' }),
    (error) => error.code === 'AI_DISABLED'
  );
  const result = await client.completeJson({
    system: 's',
    user: 'u',
    schema: { ok: 'boolean' },
    fallback: () => ({ ok: false }),
  });
  assert.equal(result.fellBack, true);
  assert.deepEqual(result.value, { ok: false });
});

test('openai-compatible provider sends bearer auth and parses response', async () => {
  const { server, port } = await startMockServer((request, res) => {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer sk-any-key');
    assert.deepEqual(request.body.messages, [
      { role: 'system', content: 'be safe' },
      { role: 'user', content: 'hello' },
    ]);
    assert.equal(request.body.model, 'gpt-4o-mini');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      model: 'gpt-4o-mini',
      choices: [{ message: { content: '  hi there  ' } }],
    }));
  });
  try {
    const client = createAiClient({
      apiKey: 'sk-any-key',
      provider: 'openai',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'gpt-4o-mini',
    });
    const result = await client.complete({ system: 'be safe', user: 'hello' });
    assert.equal(result.text, 'hi there');
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-4o-mini');
  } finally {
    server.close();
  }
});

test('anthropic provider uses x-api-key and message shape', async () => {
  const { server, port } = await startMockServer((request, res) => {
    assert.equal(request.url, '/v1/messages');
    assert.equal(request.headers['x-api-key'], 'sk-ant-any-key');
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
    assert.equal(request.body.system, 'be safe');
    assert.equal(request.body.messages[0].role, 'user');
    assert.equal(request.body.messages[0].content, 'hello');
    assert.equal(request.body.max_tokens, 1024);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      content: [{ type: 'text', text: 'claude answer' }],
    }));
  });
  try {
    const client = createAiClient({
      apiKey: 'sk-ant-any-key',
      provider: 'anthropic',
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'claude-3-5-haiku-latest',
    });
    const result = await client.complete({ system: 'be safe', user: 'hello' });
    assert.equal(result.text, 'claude answer');
    assert.equal(result.provider, 'anthropic');
  } finally {
    server.close();
  }
});

test('completeJson extracts fenced JSON', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: '```json\n{"intent":"vaccine","urgent":false}\n```' } }],
    }));
  });
  try {
    const client = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}`,
    });
    const parsed = await client.completeJson({
      system: 'classify',
      user: 'my baby has fever',
      schema: { intent: 'string', urgent: 'boolean' },
    });
    assert.equal(parsed.fellBack, false);
    assert.deepEqual(parsed.value, { intent: 'vaccine', urgent: false });
  } finally {
    server.close();
  }
});

test('completeJson falls back when provider returns an auth error', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'bad key' } }));
  });
  try {
    const client = createAiClient({
      apiKey: 'wrong-key',
      baseUrl: `http://127.0.0.1:${port}`,
    });
    await assert.rejects(
      () => client.complete({ system: 's', user: 'u' }),
      (error) => error.code === 'AI_AUTHENTICATION_FAILED'
    );
    const parsed = await client.completeJson({
      system: 's',
      user: 'u',
      schema: { ok: 'boolean' },
      fallback: () => ({ ok: false }),
    });
    assert.equal(parsed.fellBack, true);
    assert.deepEqual(parsed.value, { ok: false });
  } finally {
    server.close();
  }
});

test('provider timeout raises AI_TIMEOUT', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    setTimeout(() => {
      res.end(JSON.stringify({ choices: [{ message: { content: 'late' } }] }));
    }, 400);
  });
  try {
    const client = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 100,
    });
    await assert.rejects(
      () => client.complete({ system: 's', user: 'u' }),
      (error) => error.code === 'AI_TIMEOUT'
    );
  } finally {
    server.close();
  }
});

test('provider network failure raises AI_PROVIDER_UNREACHABLE', async () => {
  const client = createAiClient({
    apiKey: 'k',
    baseUrl: 'http://127.0.0.1:1',
    timeoutMs: 500,
  });
  await assert.rejects(
    () => client.complete({ system: 's', user: 'u' }),
    (error) => error.code === 'AI_PROVIDER_UNREACHABLE'
  );
});

test('empty provider response raises AI_EMPTY_RESPONSE', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '   ' } }] }));
  });
  try {
    const client = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}`,
    });
    await assert.rejects(
      () => client.complete({ system: 's', user: 'u' }),
      (error) => error.code === 'AI_EMPTY_RESPONSE'
    );
  } finally {
    server.close();
  }
});
