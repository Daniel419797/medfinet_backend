const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createDuplicateDetectionService,
  scorePair,
  rulesDuplicates,
  statusFor,
} = require('../services/ai/duplicateDetectionService');
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

const reference = {
  id: 'child-1',
  firstName: 'Amina',
  lastName: 'Musa',
  dateOfBirth: new Date('2025-01-15T00:00:00.000Z'),
  sex: 'FEMALE',
};

const context = { organizationId: 'org-1', actorSubjectId: 'actor-1', purpose: 'AUDIT' };

function fakeDatabase(child, candidates) {
  return {
    $transaction: async (operation) => operation({
      $executeRawUnsafe: async () => undefined,
      child: {
        findFirst: async () => child,
        findMany: async () => candidates,
      },
    }),
  };
}

test('scorePair rewards exact names and same date of birth', () => {
  const match = scorePair(reference, {
    ...reference,
    id: 'child-2',
    medfinetId: 'MF-2',
  });
  assert.ok(match.score >= 0.9);
  assert.ok(match.matchedFields.includes('date_of_birth'));
  const different = scorePair(reference, {
    id: 'child-3',
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: new Date('2020-06-01T00:00:00.000Z'),
    sex: 'MALE',
  });
  assert.ok(different.score < 0.5);
  assert.equal(different.matchedFields.length, 0);
});

test('statusFor thresholds', () => {
  assert.equal(statusFor(0.9), 'LIKELY_DUPLICATE');
  assert.equal(statusFor(0.6), 'POSSIBLE_DUPLICATE');
  assert.equal(statusFor(0.2), 'UNLIKELY');
});

test('rulesDuplicates sorts by score descending', () => {
  const candidates = [
    { id: 'c2', firstName: 'Amina', lastName: 'Musa', dateOfBirth: reference.dateOfBirth, sex: 'FEMALE', medfinetId: 'MF-2' },
    { id: 'c3', firstName: 'John', lastName: 'Doe', dateOfBirth: new Date('2020-06-01'), sex: 'MALE', medfinetId: 'MF-3' },
  ];
  const ranked = rulesDuplicates(reference, candidates);
  assert.equal(ranked[0].childId, 'c2');
  assert.equal(ranked[0].status, 'LIKELY_DUPLICATE');
  assert.equal(ranked[1].status, 'UNLIKELY');
});

test('detect falls back to rules when AI disabled', async () => {
  const service = createDuplicateDetectionService(
    fakeDatabase(reference, [{
      id: 'c2',
      firstName: 'Amina',
      lastName: 'Musa',
      dateOfBirth: reference.dateOfBirth,
      sex: 'FEMALE',
      medfinetId: 'MF-2',
    }]),
    { ai: createAiClient({ provider: 'disabled' }) }
  );
  const result = await service.detect(context, { childId: 'child-1' });
  assert.equal(result.source, 'rules');
  assert.equal(result.model, null);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'LIKELY_DUPLICATE');
});

test('detect rejects invalid limits', async () => {
  const service = createDuplicateDetectionService(fakeDatabase(reference, []), {
    ai: createAiClient({ provider: 'disabled' }),
  });
  await assert.rejects(
    () => service.detect(context, { childId: 'child-1', limit: 0 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    () => service.detect(context, { childId: 'child-1', limit: 501 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('detect rejects missing child', async () => {
  const service = createDuplicateDetectionService(fakeDatabase(null, []), {
    ai: createAiClient({ provider: 'disabled' }),
  });
  await assert.rejects(
    () => service.detect(context, { childId: 'missing' }),
    (error) => error.code === 'CHILD_NOT_FOUND'
  );
});

test('detect merges AI verdicts when enabled', async () => {
  const { server, port } = await startMockServer((request, res) => {
    assert.match(request.body.messages[1].content, /Reference child/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            candidates: [{
              childId: 'c2',
              likelyDuplicate: true,
              confidence: 0.95,
              reason: 'Identical names and date of birth.',
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
    const service = createDuplicateDetectionService(
      fakeDatabase(reference, [{
        id: 'c2',
        firstName: 'Amina',
        lastName: 'Musa',
        dateOfBirth: reference.dateOfBirth,
        sex: 'FEMALE',
        medfinetId: 'MF-2',
      }]),
      { ai }
    );
    const result = await service.detect(context, { childId: 'child-1' });
    assert.equal(result.source, 'ai');
    assert.equal(result.items[0].status, 'LIKELY_DUPLICATE');
    assert.equal(result.items[0].aiConfidence, 0.95);
    assert.match(result.items[0].reason, /Identical names/);
  } finally {
    server.close();
  }
});

test('detect falls back on provider failure', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.statusCode = 429;
    res.end(JSON.stringify({ error: { message: 'rate limited' } }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    });
    const service = createDuplicateDetectionService(
      fakeDatabase(reference, [{
        id: 'c2',
        firstName: 'Amina',
        lastName: 'Musa',
        dateOfBirth: reference.dateOfBirth,
        sex: 'FEMALE',
        medfinetId: 'MF-2',
      }]),
      { ai }
    );
    const result = await service.detect(context, { childId: 'child-1' });
    assert.equal(result.source, 'rules');
    assert.equal(result.items[0].score > 0, true);
  } finally {
    server.close();
  }
});
