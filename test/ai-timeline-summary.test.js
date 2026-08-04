const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createTimelineSummaryService,
  compactEvents,
  rulesSummary,
} = require('../services/ai/timelineSummaryService');
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

const context = { organizationId: 'org-1', actorSubjectId: 'actor-1', purpose: 'CARE' };

const timeline = {
  immunizations: [{
    id: 'imm-1',
    vaccineCode: 'PENTA',
    doseNumber: 2,
    administeredAt: new Date('2026-05-10T00:00:00.000Z'),
  }],
  growth: [{
    id: 'g-1',
    measuredAt: new Date('2026-05-10T00:00:00.000Z'),
    weightGrams: 7100,
    heightMillimeters: 650,
    muacMillimeters: null,
  }],
  alerts: [{
    id: 'a-1',
    category: 'NUTRITION',
    severity: 'HIGH',
    summary: 'Weight below target',
    status: 'ACTIVE',
  }],
  allergies: [{
    id: 'al-1',
    substanceDisplay: 'Peanuts',
    severity: 'HIGH',
    status: 'ACTIVE',
  }],
  appointments: [{
    id: 'ap-1',
    scheduledFor: new Date('2026-08-01T00:00:00.000Z'),
    status: 'SCHEDULED',
  }],
};

test('compactEvents flattens timeline records', () => {
  const events = compactEvents(timeline, 'en');
  assert.ok(events.some((event) => event.includes('PENTA dose 2')));
  assert.ok(events.some((event) => event.includes('7.1kg')));
  assert.ok(events.some((event) => event.includes('Weight below target')));
  assert.ok(events.some((event) => event.includes('Peanuts')));
});

test('rulesSummary mentions alerts and allergies', () => {
  const summary = rulesSummary(timeline, compactEvents(timeline, 'en'), 'en');
  assert.match(summary, /1 vaccine dose/);
  assert.match(summary, /1 active clinical alert/);
  assert.match(summary, /Peanuts/);
  assert.match(summary, /Latest vaccine: PENTA dose 2/);
  assert.match(summary, /Next appointment/);
});

test('summarize falls back to rules when AI disabled', async () => {
  const service = createTimelineSummaryService(null, {
    ai: createAiClient({ provider: 'disabled' }),
    timeline: { get: async () => timeline },
  });
  const result = await service.summarize(context, { childId: 'child-1' });
  assert.equal(result.source, 'rules');
  assert.equal(result.eventCount, 5);
  assert.match(result.summary, /Peanuts/);
});

test('summarize uses AI when enabled', async () => {
  const { server, port } = await startMockServer((request, res) => {
    assert.match(request.body.messages[0].content, /summarizer/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: 'Amina is up to date on vaccines and has a peanut allergy.',
            nextSteps: ['Attend the next appointment in August.'],
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
    const service = createTimelineSummaryService(null, {
      ai,
      timeline: { get: async () => timeline },
    });
    const result = await service.summarize(context, { childId: 'child-1' });
    assert.equal(result.source, 'ai');
    assert.match(result.summary, /peanut allergy/);
    assert.equal(result.nextSteps.length, 1);
  } finally {
    server.close();
  }
});

test('summarize falls back when provider rejects the key', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: 'invalid key' } }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'bad',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    });
    const service = createTimelineSummaryService(null, {
      ai,
      timeline: { get: async () => timeline },
    });
    const result = await service.summarize(context, { childId: 'child-1' });
    assert.equal(result.source, 'rules');
    assert.match(result.summary, /1 vaccine dose/);
  } finally {
    server.close();
  }
});
