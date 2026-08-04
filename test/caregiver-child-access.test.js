const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createCaregiverChildAccessMiddleware,
} = require('../middleware/caregiverChildAccess');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function caregiverRequest() {
  return {
    actorSubjectId: 'caregiver-subject',
    organization: { id: 'org-1', membership: { role: 'CAREGIVER' } },
    params: { id: 'child-1' },
  };
}

test('allows non-caregiver roles without a caregiver relationship lookup', async () => {
  const middleware = createCaregiverChildAccessMiddleware({ prismaClient: {} });
  const req = caregiverRequest();
  req.organization.membership.role = 'HEALTH_WORKER';
  let nextCalled = false;

  await middleware(req, responseRecorder(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('allows a caregiver only when the requested child is linked to their subject', async () => {
  let query;
  const middleware = createCaregiverChildAccessMiddleware({
    prismaClient: {
      childCaregiver: {
        async findFirst(input) { query = input; return { id: 'link-1' }; },
      },
    },
  });
  let nextCalled = false;

  await middleware(caregiverRequest(), responseRecorder(), () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(query.where, {
    organizationId: 'org-1',
    childId: 'child-1',
    caregiver: { subjectId: 'caregiver-subject' },
  });
});

test('denies a caregiver when no relationship exists', async () => {
  const middleware = createCaregiverChildAccessMiddleware({
    prismaClient: {
      childCaregiver: { async findFirst() { return null; } },
    },
  });
  const response = responseRecorder();

  await middleware(
    caregiverRequest(),
    response,
    () => assert.fail('next should not run')
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'CAREGIVER_CHILD_ACCESS_DENIED');
});
