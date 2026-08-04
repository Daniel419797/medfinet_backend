const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createNarrativeService,
  rulesNarrative,
  percent,
} = require('../services/ai/narrativeService');
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

const metrics = [
  {
    key: 'registered_children',
    numerator: 100,
    denominator: null,
    valueBasisPoints: null,
    cohortSize: 100,
  },
  {
    key: 'immunization_reach',
    numerator: 80,
    denominator: 100,
    valueBasisPoints: 8000,
    cohortSize: 100,
  },
  {
    key: 'vitamin_a_reach',
    numerator: 60,
    denominator: 100,
    valueBasisPoints: 6000,
    cohortSize: 100,
  },
  {
    key: 'eligible_worklist_completion',
    numerator: 50,
    denominator: 100,
    valueBasisPoints: 5000,
    cohortSize: 100,
  },
  {
    key: 'referral_completion',
    numerator: 25,
    denominator: 100,
    valueBasisPoints: 2500,
    cohortSize: 100,
  },
  {
    key: 'service_deliveries',
    numerator: 42,
    denominator: null,
    valueBasisPoints: null,
    cohortSize: 42,
  },
];

const context = { organizationId: 'org-1', actorSubjectId: 'actor-1', purpose: 'REPORT' };

function fakeQuery(overrides = {}) {
  return {
    latestInternal: async () => ({
      run: {
        periodStart: new Date('2026-01-01T00:00:00.000Z'),
        periodEnd: new Date('2026-01-31T00:00:00.000Z'),
      },
      metrics,
      ...overrides,
    }),
  };
}

test('percent converts basis points', () => {
  assert.equal(percent(8000), '80.0');
  assert.equal(percent(null), null);
});

test('rulesNarrative builds a factual report', () => {
  const narrative = rulesNarrative(metrics);
  assert.match(narrative, /100 children were registered/);
  assert.match(narrative, /Immunization reach was 80.0%/);
  assert.match(narrative, /42 service deliveries/);
});

test('narrative falls back to rules when AI is disabled', async () => {
  const service = createNarrativeService({
    ai: createAiClient({ provider: 'disabled' }),
    query: fakeQuery(),
  });
  const result = await service.generate(context);
  assert.equal(result.source, 'rules');
  assert.equal(result.model, null);
  assert.match(result.narrative, /Immunization reach was 80.0%/);
});

test('narrative uses AI when enabled', async () => {
  const { server, port } = await startMockServer((request, res) => {
    assert.match(request.body.messages[0].content, /programme/);
    assert.match(request.body.messages[1].content, /2026-01-01/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            narrative: 'Reach improved across the period.',
            keyFindings: ['Reach is 80%.'],
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
    const service = createNarrativeService({ ai, query: fakeQuery() });
    const result = await service.generate(context);
    assert.equal(result.source, 'ai');
    assert.deepEqual(result.keyFindings, ['Reach is 80%.']);
    assert.ok(result.periodStart);
  } finally {
    server.close();
  }
});

test('narrative throws when no completed run exists', async () => {
  const service = createNarrativeService({
    ai: createAiClient({ provider: 'disabled' }),
    query: { latestInternal: async () => ({ run: null, metrics: [] }) },
  });
  await assert.rejects(
    () => service.generate(context),
    (error) => error.code === 'ANALYTICS_RUN_NOT_FOUND'
  );
});
