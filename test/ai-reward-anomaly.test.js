const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createRewardAnomalyService,
  rulesAnomalies,
  signalsFor,
  zScore,
  mean,
  stdDev,
} = require('../services/ai/rewardAnomalyService');
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

const context = { organizationId: 'org-1', actorSubjectId: 'actor-1', purpose: 'AUDIT' };

function redemption(overrides) {
  return {
    id: 'r-1',
    amount: 500,
    merchantId: 'merchant-1',
    merchantReference: 'REF-1',
    redeemedBySubjectId: 'caregiver-1',
    redeemedAt: new Date('2026-07-01T10:00:00.000Z'),
    ...overrides,
  };
}

function fakeDatabase(redemptions) {
  return {
    $transaction: async (operation) => operation({
      $executeRawUnsafe: async () => undefined,
      rewardRedemption: { findMany: async () => redemptions },
    }),
  };
}

test('mean, stdDev and zScore math', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(stdDev([1, 1, 1]), 0);
  assert.equal(zScore(10, 5, 2), 2.5);
  assert.equal(zScore(10, 5, 0), 0);
});

test('signalsFor flags velocity, reference reuse and outliers', () => {
  const velocity = signalsFor(redemption({}), new Map([['caregiver-1', { count: 4 }]]), new Map(), new Map());
  assert.ok(velocity.signals.some((signal) => signal.startsWith('high_redemption_velocity')));
  assert.ok(velocity.score >= 0.6);
  assert.equal(velocity.suspicious, true);

  const reuse = signalsFor(
    redemption({}),
    new Map([['caregiver-1', { count: 1 }]]),
    new Map([['REF-1', 3]]),
    new Map()
  );
  assert.ok(reuse.signals.some((signal) => signal.startsWith('reused_merchant_reference')));

  const outlier = signalsFor(
    redemption({}),
    new Map([['caregiver-1', { count: 1 }]]),
    new Map([['REF-1', 1]]),
    new Map([['merchant-1', { mean: 100, stdDev: 50 }]])
  );
  assert.ok(outlier.signals.some((signal) => signal.startsWith('amount_outlier')));

  const clean = signalsFor(
    redemption({}),
    new Map([['caregiver-1', { count: 1 }]]),
    new Map([['REF-1', 1]]),
    new Map([['merchant-1', { mean: 500, stdDev: 40 }]])
  );
  assert.equal(clean.score, 0);
  assert.equal(clean.suspicious, false);
});

test('rulesAnomalies marks suspicious redemptions', () => {
  const redemptions = [
    redemption({ id: 'r-fast', redeemedBySubjectId: 'caregiver-fast' }),
    redemption({ id: 'r-fast-2', redeemedBySubjectId: 'caregiver-fast' }),
    redemption({ id: 'r-fast-3', redeemedBySubjectId: 'caregiver-fast' }),
    redemption({ id: 'r-normal' }),
  ];
  const result = rulesAnomalies(redemptions);
  const fast = result.find((item) => item.redemptionId === 'r-fast');
  const normal = result.find((item) => item.redemptionId === 'r-normal');
  assert.equal(fast.suspicious, true);
  assert.equal(normal.suspicious, false);
});

test('detect falls back to rules when AI disabled', async () => {
  const service = createRewardAnomalyService(
    fakeDatabase([redemption({}), redemption({})]),
    { ai: createAiClient({ provider: 'disabled' }) }
  );
  const result = await service.detect(context, {});
  assert.equal(result.source, 'rules');
  assert.equal(result.items.length, 2);
});

test('detect returns empty note when no redemptions', async () => {
  const service = createRewardAnomalyService(fakeDatabase([]), {
    ai: createAiClient({ provider: 'disabled' }),
  });
  const result = await service.detect(context, {});
  assert.deepEqual(result.items, []);
  assert.match(result.note, /No completed redemptions/);
});

test('detect rejects invalid limits', async () => {
  const service = createRewardAnomalyService(fakeDatabase([]), {
    ai: createAiClient({ provider: 'disabled' }),
  });
  await assert.rejects(
    () => service.detect(context, { limit: 0 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    () => service.detect(context, { limit: 501 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('detect merges AI verdicts when enabled', async () => {
  const redemptions = [
    redemption({ id: 'r-fast', redeemedBySubjectId: 'caregiver-fast' }),
    redemption({ id: 'r-fast-2', redeemedBySubjectId: 'caregiver-fast' }),
    redemption({ id: 'r-fast-3', redeemedBySubjectId: 'caregiver-fast' }),
  ];
  const { server, port } = await startMockServer((request, res) => {
    assert.match(request.body.messages[1].content, /Redemption signals/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            anomalies: [{
              redemptionId: 'r-fast',
              suspicious: true,
              reason: 'Rapid repeated redemptions.',
            }],
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
    const service = createRewardAnomalyService(fakeDatabase(redemptions), { ai });
    const result = await service.detect(context, {});
    assert.equal(result.source, 'ai');
    const flagged = result.items.find((item) => item.redemptionId === 'r-fast');
    assert.equal(flagged.suspicious, true);
    assert.match(flagged.reason, /Rapid repeated redemptions/);
  } finally {
    server.close();
  }
});

test('detect falls back on provider failure', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: { message: 'boom' } }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    });
    const service = createRewardAnomalyService(fakeDatabase([redemption({})]), { ai });
    const result = await service.detect(context, {});
    assert.equal(result.source, 'rules');
    assert.equal(result.items.length, 1);
  } finally {
    server.close();
  }
});
