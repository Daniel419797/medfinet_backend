const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createAssistantService,
  rulesAnswer,
  normalizeQuestion,
} = require('../services/ai/assistantService');
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

function fakeDatabase(child) {
  return {
    $transaction: async (operation) => operation({
      $executeRawUnsafe: async () => undefined,
      child: {
        findFirst: async () => child,
      },
    }),
  };
}

function fakeSchedule(recommendations) {
  return {
    evaluate: async () => ({ childId: 'child-1', recommendations }),
  };
}

const childRecord = {
  id: 'child-1',
  firstName: 'Amina',
  dateOfBirth: new Date('2025-01-15T00:00:00.000Z'),
  sex: 'FEMALE',
  immunizations: [],
  appointments: [],
  ageMonths: 18,
  nextAppointment: null,
};

const context = { organizationId: 'org-1', actorSubjectId: 'actor-1', purpose: 'ASSIST' };

const overdue = [{
  vaccineCode: 'PENTA',
  doseNumber: 1,
  status: 'OVERDUE',
  dueAt: new Date('2026-06-01T00:00:00.000Z'),
}];
const upcoming = [{
  vaccineCode: 'MEASLES',
  doseNumber: 1,
  status: 'UPCOMING',
  dueAt: new Date('2026-09-01T00:00:00.000Z'),
}];

test('rulesAnswer summarizes overdue and upcoming vaccines', () => {
  const answer = rulesAnswer([...overdue, ...upcoming], null, 'en');
  assert.match(answer, /overdue for PENTA dose 1/);
  assert.match(answer, /MEASLES dose 1/);
});

test('rulesAnswer reports up to date when nothing pending', () => {
  const answer = rulesAnswer([{
    vaccineCode: 'PENTA',
    doseNumber: 1,
    status: 'COMPLETED',
    dueAt: new Date(),
  }], null, 'en');
  assert.match(answer, /up to date/);
});

test('normalizeQuestion rejects empty or overlong questions', () => {
  assert.throws(() => normalizeQuestion({}), (error) => error.code === 'VALIDATION_ERROR');
  assert.throws(
    () => normalizeQuestion({ question: 'x'.repeat(501) }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.equal(normalizeQuestion({ question: 'when?', locale: 'zz' }).locale, 'en');
});

test('assistant falls back to rules when AI is disabled', async () => {
  const service = createAssistantService(fakeDatabase(childRecord), {
    ai: createAiClient({ provider: 'disabled' }),
    schedule: fakeSchedule([...overdue, ...upcoming]),
  });
  const result = await service.ask(context, { childId: 'child-1', question: 'what is next?' });
  assert.equal(result.source, 'rules');
  assert.equal(result.model, null);
  assert.equal(result.urgent, true);
  assert.match(result.answer, /PENTA dose 1/);
});

test('assistant uses AI answer when enabled', async () => {
  const { server, port } = await startMockServer((request, res) => {
    assert.match(request.body.messages[1].content, /Amina/);
    assert.match(request.body.messages[1].content, /next shot/i);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            answer: 'Your child is overdue for PENTA dose 1.',
            urgent: true,
          }),
        },
      }],
    }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'gpt-4o-mini',
    });
    const service = createAssistantService(fakeDatabase(childRecord), {
      ai,
      schedule: fakeSchedule([...overdue, ...upcoming]),
    });
    const result = await service.ask(context, { childId: 'child-1', question: 'when is next shot?' });
    assert.equal(result.source, 'ai');
    assert.equal(result.model, 'gpt-4o-mini');
    assert.match(result.answer, /PENTA/);
    assert.equal(result.urgent, true);
  } finally {
    server.close();
  }
});

test('assistant falls back when the provider rejects the key', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: 'invalid key' } }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'bad-key',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    });
    const service = createAssistantService(fakeDatabase(childRecord), {
      ai,
      schedule: fakeSchedule([...overdue, ...upcoming]),
    });
    const result = await service.ask(context, { childId: 'child-1', question: 'when is next shot?' });
    assert.equal(result.source, 'rules');
    assert.match(result.answer, /PENTA dose 1/);
  } finally {
    server.close();
  }
});

test('assistant rejects missing child', async () => {
  const database = {
    $transaction: async (operation) => operation({
      $executeRawUnsafe: async () => undefined,
      child: { findFirst: async () => null },
    }),
  };
  const service = createAssistantService(database, {
    ai: createAiClient({ provider: 'disabled' }),
    schedule: fakeSchedule([]),
  });
  await assert.rejects(
    () => service.ask(context, { childId: 'missing', question: 'how is my child?' }),
    (error) => error.code === 'CHILD_NOT_FOUND'
  );
});
