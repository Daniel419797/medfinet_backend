const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createOrganizationAccessMiddleware,
  resolveSubjectId,
} = require('../middleware/organizationAccess');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(headers = {}, user = { id: 'subject-1' }) {
  return {
    user,
    get(name) { return headers[name.toLowerCase()]; },
  };
}

test('resolves supported authenticated subject identifiers', () => {
  assert.equal(resolveSubjectId({ id: 'supabase-id' }), 'supabase-id');
  assert.equal(resolveSubjectId({ sub: 'jwt-subject' }), 'jwt-subject');
  assert.equal(resolveSubjectId({ hospital_id: 'legacy-hospital' }), 'legacy-hospital');
});

test('requires organization and purpose headers', async () => {
  const middleware = createOrganizationAccessMiddleware({ prismaClient: {} });
  const response = responseRecorder();

  await middleware(request(), response, () => assert.fail('next should not run'));
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'ORGANIZATION_REQUIRED');

  await middleware(
    request({ 'x-organization-id': 'org-1' }),
    response,
    () => assert.fail('next should not run')
  );
  assert.equal(response.body.code, 'ACCESS_PURPOSE_REQUIRED');
});

test('denies inactive or cross-organization memberships', async () => {
  const prismaClient = {
    organizationMembership: { findUnique: async () => null },
  };
  const middleware = createOrganizationAccessMiddleware({ prismaClient });
  const response = responseRecorder();

  await middleware(
    request({ 'x-organization-id': 'org-2', 'x-access-purpose': 'continuity-of-care' }),
    response,
    () => assert.fail('next should not run')
  );
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'ORGANIZATION_ACCESS_DENIED');
});

test('attaches verified organization context for an active member', async () => {
  const membership = {
    role: 'HEALTH_WORKER',
    status: 'ACTIVE',
    organization: { status: 'ACTIVE' },
  };
  const prismaClient = {
    organizationMembership: { findUnique: async () => membership },
  };
  const middleware = createOrganizationAccessMiddleware({ prismaClient });
  const req = request({
    'x-organization-id': 'org-1',
    'x-access-purpose': ' continuity-of-care ',
  });
  const response = responseRecorder();
  let nextCalled = false;

  await middleware(req, response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.organization.id, 'org-1');
  assert.equal(req.actorSubjectId, 'subject-1');
  assert.equal(req.accessPurpose, 'continuity-of-care');
});

test('denies active members whose role is not allowed for a write operation', async () => {
  const prismaClient = {
    organizationMembership: {
      findUnique: async () => ({
        role: 'AUDITOR',
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      }),
    },
  };
  const middleware = createOrganizationAccessMiddleware({
    prismaClient,
    allowedRoles: ['OWNER', 'ADMIN', 'HEALTH_WORKER'],
  });
  const response = responseRecorder();

  await middleware(
    request({ 'x-organization-id': 'org-1', 'x-access-purpose': 'registration' }),
    response,
    () => assert.fail('next should not run')
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'ORGANIZATION_ACCESS_DENIED');
});

test('can explicitly allow a suspended organization for owner recovery', async () => {
  const prismaClient = {
    organizationMembership: {
      findUnique: async () => ({
        role: 'OWNER',
        status: 'ACTIVE',
        organization: { status: 'SUSPENDED' },
      }),
    },
  };
  const middleware = createOrganizationAccessMiddleware({
    prismaClient,
    allowedRoles: ['OWNER'],
    allowedOrganizationStatuses: ['ACTIVE', 'SUSPENDED'],
  });
  const req = request({
    'x-organization-id': 'org-1',
    'x-access-purpose': 'restore-approved-operations',
  });
  const response = responseRecorder();
  let nextCalled = false;

  await middleware(req, response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.organization.membership.organization.status, 'SUSPENDED');
});

test('still denies suspended organizations through the default guard', async () => {
  const prismaClient = {
    organizationMembership: {
      findUnique: async () => ({
        role: 'OWNER',
        status: 'ACTIVE',
        organization: { status: 'SUSPENDED' },
      }),
    },
  };
  const middleware = createOrganizationAccessMiddleware({ prismaClient });
  const response = responseRecorder();

  await middleware(
    request({
      'x-organization-id': 'org-1',
      'x-access-purpose': 'ordinary-operation',
    }),
    response,
    () => assert.fail('next should not run')
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'ORGANIZATION_ACCESS_DENIED');
});
