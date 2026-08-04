const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createConsentService,
  grantCoversScopes,
  normalizeScopes,
} = require('../services/consentService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

function context(overrides = {}) {
  return {
    organizationId: 'org-1',
    actorSubjectId: 'worker-1',
    role: 'HEALTH_WORKER',
    purpose: 'consent-administration',
    ...overrides,
  };
}

function baseTransaction(overrides = {}) {
  return {
    async $executeRawUnsafe() {},
    outboxEvent: { async create() {} },
    child: {
      async findFirst() {
        return { id: 'child-1' };
      },
    },
    ...overrides,
  };
}

function validGrantInput() {
  return {
    grantedByCaregiverId: 'caregiver-1',
    recipientType: 'PROGRAMME',
    recipientId: 'programme-1',
    purpose: 'routine-immunization',
    legalBasis: 'caregiver-consent',
    policyVersion: 'privacy-v1',
    captureMethod: 'ASSISTED_DIGITAL',
    expiresAt: '2030-01-01T00:00:00.000Z',
    scopes: [
      { category: 'IDENTITY', access: 'READ' },
      { category: 'IMMUNIZATION', access: 'WRITE' },
    ],
  };
}

test('normalizes unique consent scopes and rejects duplicates', () => {
  assert.deepEqual(normalizeScopes([
    { category: 'IDENTITY', access: 'READ' },
  ]), [
    { category: 'IDENTITY', access: 'READ' },
  ]);
  assert.throws(
    () => normalizeScopes([
      { category: 'IDENTITY', access: 'READ' },
      { category: 'IDENTITY', access: 'WRITE' },
    ]),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('write consent covers a read request but read consent does not cover write', () => {
  const grant = {
    scopes: [{ category: 'IMMUNIZATION', access: 'WRITE' }],
  };
  assert.equal(grantCoversScopes(grant, [
    { category: 'IMMUNIZATION', access: 'READ' },
  ]), true);
  assert.equal(grantCoversScopes({
    scopes: [{ category: 'IMMUNIZATION', access: 'READ' }],
  }, [
    { category: 'IMMUNIZATION', access: 'WRITE' },
  ]), false);
});

test('creates scoped consent only for a caregiver with consent authority', async () => {
  const calls = [];
  const transaction = baseTransaction({
    childCaregiver: {
      async findFirst({ where }) {
        assert.equal(where.organizationId, 'org-1');
        assert.equal(where.hasConsentAuthority, true);
        return {
          caregiverId: 'caregiver-1',
          caregiver: { subjectId: 'caregiver-subject' },
        };
      },
    },
    consentGrant: {
      async create({ data }) {
        calls.push(['grant', data]);
        return {
          id: 'consent-1',
          ...data,
          scopes: data.scopes.createMany.data.map((scope, index) => ({
            id: `scope-${index + 1}`,
            ...scope,
          })),
        };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createConsentService(databaseWithTransaction(transaction));

  const grant = await service.grantConsent(context(), 'child-1', validGrantInput());

  assert.equal(grant.id, 'consent-1');
  assert.equal(calls[0][1].organizationId, 'org-1');
  assert.equal(calls[0][1].scopes.createMany.data.length, 2);
  assert.equal(calls[1][1].action, 'consent.granted');
});

test('rejects a consent grant from a caregiver without authority', async () => {
  const transaction = baseTransaction({
    childCaregiver: {
      async findFirst() {
        return null;
      },
    },
  });
  const service = createConsentService(databaseWithTransaction(transaction));

  await assert.rejects(
    service.grantConsent(context(), 'child-1', validGrantInput()),
    (error) => error.code === 'CONSENT_AUTHORITY_REQUIRED' && error.status === 403
  );
});

test('allows the granting caregiver to withdraw active consent', async () => {
  const calls = [];
  const transaction = baseTransaction({
    consentGrant: {
      async findFirst() {
        return {
          id: 'consent-1',
          childId: 'child-1',
          status: 'ACTIVE',
          caregiver: { subjectId: 'caregiver-subject' },
        };
      },
      async update({ data }) {
        calls.push(['update', data]);
        return {
          id: 'consent-1',
          childId: 'child-1',
          ...data,
          scopes: [],
        };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createConsentService(databaseWithTransaction(transaction));

  const grant = await service.withdrawConsent(
    context({ actorSubjectId: 'caregiver-subject', role: 'CAREGIVER' }),
    'consent-1',
    { reason: 'No longer participating' }
  );

  assert.equal(grant.status, 'WITHDRAWN');
  assert.equal(calls[0][1].withdrawnBySubjectId, 'caregiver-subject');
  assert.equal(calls[1][1].action, 'consent.withdrawn');
});

test('records an allowed disclosure only when one active grant covers all scopes', async () => {
  const transaction = baseTransaction({
    consentGrant: {
      async findMany({ where }) {
        assert.equal(where.organizationId, 'org-1');
        assert.equal(where.status, 'ACTIVE');
        return [{
          id: 'consent-1',
          scopes: [
            { category: 'IDENTITY', access: 'READ' },
            { category: 'IMMUNIZATION', access: 'WRITE' },
          ],
        }];
      },
    },
    disclosureEvent: {
      async create({ data }) {
        assert.equal(data.decision, 'ALLOWED');
        assert.equal(data.consentGrantId, 'consent-1');
        return { id: 'disclosure-1', ...data };
      },
    },
  });
  const service = createConsentService(databaseWithTransaction(transaction));

  const decision = await service.evaluateDisclosure(context(), 'child-1', {
    recipientType: 'PROGRAMME',
    recipientId: 'programme-1',
    purpose: 'routine-immunization',
    scopes: [
      { category: 'IDENTITY', access: 'READ' },
      { category: 'IMMUNIZATION', access: 'READ' },
    ],
  });

  assert.deepEqual(decision, {
    allowed: true,
    reasonCode: 'ACTIVE_CONSENT',
    consentGrantId: 'consent-1',
    disclosureEventId: 'disclosure-1',
  });
});

test('records a denied disclosure when applicable consent is absent', async () => {
  const transaction = baseTransaction({
    consentGrant: {
      async findMany() {
        return [];
      },
    },
    disclosureEvent: {
      async create({ data }) {
        assert.equal(data.decision, 'DENIED');
        assert.equal(Object.hasOwn(data, 'consentGrantId'), false);
        return { id: 'disclosure-denied', ...data };
      },
    },
  });
  const service = createConsentService(databaseWithTransaction(transaction));

  const decision = await service.evaluateDisclosure(context(), 'child-1', {
    recipientType: 'RESEARCH',
    recipientId: 'study-1',
    purpose: 'approved-study',
    scopes: [{ category: 'NUTRITION', access: 'READ' }],
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, 'NO_APPLICABLE_CONSENT');
  assert.equal(decision.disclosureEventId, 'disclosure-denied');
});
