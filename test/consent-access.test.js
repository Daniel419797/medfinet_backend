const assert = require('node:assert/strict');
const test = require('node:test');
const { createConsentAccessMiddleware } = require('../middleware/consentAccess');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function request() {
  return {
    params: { id: 'child-1' },
    organization: {
      id: 'org-1',
      membership: { role: 'HEALTH_WORKER' },
    },
    actorSubjectId: 'worker-1',
    accessPurpose: 'continuity-of-care',
    requestId: 'request-1',
  };
}

test('evaluates fixed server-owned scopes for the verified organization', async () => {
  let evaluation;
  const middleware = createConsentAccessMiddleware({
    scopes: [{ category: 'IMMUNIZATION', access: 'READ' }],
    consentService: {
      async evaluateDisclosure(context, childId, input) {
        evaluation = { context, childId, input };
        return {
          allowed: true,
          reasonCode: 'ACTIVE_CONSENT',
          consentGrantId: 'consent-1',
          disclosureEventId: 'disclosure-1',
        };
      },
    },
  });
  const req = request();
  const res = responseRecorder();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(evaluation.context.organizationId, 'org-1');
  assert.equal(evaluation.childId, 'child-1');
  assert.equal(evaluation.input.recipientType, 'ORGANIZATION');
  assert.equal(evaluation.input.recipientId, 'org-1');
  assert.deepEqual(evaluation.input.scopes, [
    { category: 'IMMUNIZATION', access: 'READ' },
  ]);
  assert.equal(req.disclosureDecision.disclosureEventId, 'disclosure-1');
});

test('denies the request after recording an absent-consent decision', async () => {
  const middleware = createConsentAccessMiddleware({
    scopes: [{ category: 'CLINICAL_ALERTS', access: 'READ' }],
    consentService: {
      async evaluateDisclosure() {
        return {
          allowed: false,
          reasonCode: 'NO_APPLICABLE_CONSENT',
          consentGrantId: null,
          disclosureEventId: 'disclosure-denied',
        };
      },
    },
  });
  const req = request();
  const res = responseRecorder();

  await middleware(req, res, () => assert.fail('next should not run'));

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'CONSENT_REQUIRED');
  assert.equal(res.body.disclosureEventId, 'disclosure-denied');
  assert.equal(res.body.requestId, 'request-1');
});
