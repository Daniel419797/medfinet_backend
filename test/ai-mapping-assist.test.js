const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createMappingAssistService,
  rulesCorrespondences,
  similarity,
  normalizeKey,
} = require('../services/ai/mappingAssistService');
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

const sourceFields = ['first_name', 'dob', 'sex', 'vaccine_name'];
const targetFields = ['firstName', 'dateOfBirth', 'sex', 'vaccineCode'];

test('normalizeKey and similarity', () => {
  assert.equal(normalizeKey('First Name'), 'givenname');
  assert.equal(similarity('firstName', 'firstName'), 1);
  assert.equal(similarity('first_name', 'firstName'), 1);
  assert.equal(similarity('vaccine_name', 'vaccineCode'), 1);
  assert.equal(similarity('dob', 'dateOfBirth'), 1);
  assert.equal(similarity('zip', 'postal_code'), 0);
});

test('rulesCorrespondences matches exact and substring fields', () => {
  const correspondences = rulesCorrespondences(sourceFields, targetFields);
  assert.equal(correspondences.length, 4);
  const dob = correspondences.find((entry) => entry.sourceField === 'dob');
  assert.equal(dob.targetField, 'dateOfBirth');
  const vaccine = correspondences.find((entry) => entry.sourceField === 'vaccine_name');
  assert.equal(vaccine.targetField, 'vaccineCode');
  assert.ok(vaccine.confidence >= 0.75);
});

test('suggest falls back to rules when AI disabled', async () => {
  const service = createMappingAssistService({ ai: createAiClient({ provider: 'disabled' }) });
  const result = await service.suggest({
    connectionType: 'FHIR_R4',
    resourceType: 'Patient',
    sourceFields,
    targetFields,
  });
  assert.equal(result.source, 'rules');
  assert.equal(result.connectionType, 'FHIR_R4');
  assert.ok(result.correspondences.length >= 2);
});

test('suggest rejects invalid inputs', async () => {
  const service = createMappingAssistService({ ai: createAiClient({ provider: 'disabled' }) });
  await assert.rejects(
    () => service.suggest({ connectionType: 'SOAP', resourceType: 'Patient', sourceFields, targetFields }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    () => service.suggest({ connectionType: 'DHIS2', resourceType: 'Patient', sourceFields: [], targetFields }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    () => service.suggest({ connectionType: 'DHIS2', resourceType: 'Patient', sourceFields: ['x'.repeat(161)], targetFields }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('suggest uses AI correspondences and filters invalid ones', async () => {
  const { server, port } = await startMockServer((request, res) => {
    assert.match(request.body.messages[1].content, /first_name/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            correspondences: [
              { sourceField: 'first_name', targetField: 'firstName', confidence: 1, notes: 'exact' },
              { sourceField: 'dob', targetField: 'dateOfBirth', confidence: 0.9, notes: 'clear match' },
              { sourceField: 'made_up', targetField: 'firstName', confidence: 0.99, notes: 'invalid' },
            ],
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
    const service = createMappingAssistService({ ai });
    const result = await service.suggest({
      connectionType: 'DHIS2',
      resourceType: 'TRACKED_ENTITY',
      sourceFields,
      targetFields,
    });
    assert.equal(result.source, 'ai');
    assert.equal(result.correspondences.length, 2);
    assert.ok(!result.correspondences.some((entry) => entry.sourceField === 'made_up'));
  } finally {
    server.close();
  }
});

test('suggest falls back on provider failure', async () => {
  const { server, port } = await startMockServer((_request, res) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: { message: 'boom' } }));
  });
  try {
    const ai = createAiClient({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    });
    const service = createMappingAssistService({ ai });
    const result = await service.suggest({
      connectionType: 'FHIR_R4',
      resourceType: 'Immunization',
      sourceFields,
      targetFields,
    });
    assert.equal(result.source, 'rules');
    assert.ok(result.correspondences.length >= 2);
  } finally {
    server.close();
  }
});
