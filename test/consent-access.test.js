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

function deniedDecision() {
  return {
    allowed: false,
    reasonCode: 'NO_APPLICABLE_CONSENT',
    consentGrantId: null,
    disclosureEventId: 'disclosure-denied',
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
        return deniedDecision();
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

test('allows OWNER and ADMIN read-only disclosures when admin=test', async () => {
  const previous = process.env.admin;
  process.env.admin = 'test';
  try {
    for (const role of ['OWNER', 'ADMIN']) {
      const middleware = createConsentAccessMiddleware({
        scopes: [
          { category: 'IDENTITY', access: 'READ' },
          { category: 'IMMUNIZATION', access: 'READ' },
        ],
        consentService: {
          async evaluateDisclosure() {
            return deniedDecision();
          },
        },
      });
      const req = request();
      req.organization.membership.role = role;
      const res = responseRecorder();
      let nextCalled = false;

      await middleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
      assert.equal(res.statusCode, 200);
      assert.equal(req.disclosureDecision.allowed, true);
      assert.equal(req.disclosureDecision.reasonCode, 'ADMIN_TEST_BYPASS');
      assert.equal(req.consentBypass.type, 'ADMIN_TEST');
      assert.equal(req.consentBypass.originalReasonCode, 'NO_APPLICABLE_CONSENT');
    }
  } finally {
    if (previous === undefined) delete process.env.admin;
    else process.env.admin = previous;
  }
});

test('admin=test does not bypass consent for non-admin roles or write scopes', async () => {
  const previous = process.env.admin;
  process.env.admin = 'test';
  try {
    const nonAdminMiddleware = createConsentAccessMiddleware({
      scopes: [{ category: 'IMMUNIZATION', access: 'READ' }],
      consentService: {
        async evaluateDisclosure() {
          return deniedDecision();
        },
      },
    });
    const healthWorkerRequest = request();
    const healthWorkerResponse = responseRecorder();
    await nonAdminMiddleware(
      healthWorkerRequest,
      healthWorkerResponse,
      () => assert.fail('health worker must not bypass consent')
    );
    assert.equal(healthWorkerResponse.statusCode, 403);

    const writeMiddleware = createConsentAccessMiddleware({
      scopes: [{ category: 'CLIMATE', access: 'WRITE' }],
      consentService: {
        async evaluateDisclosure() {
          return deniedDecision();
        },
      },
    });
    const adminRequest = request();
    adminRequest.organization.membership.role = 'ADMIN';
    const adminResponse = responseRecorder();
    await writeMiddleware(
      adminRequest,
      adminResponse,
      () => assert.fail('write scope must not bypass consent')
    );
    assert.equal(adminResponse.statusCode, 403);
  } finally {
    if (previous === undefined) delete process.env.admin;
    else process.env.admin = previous;
  }
});
