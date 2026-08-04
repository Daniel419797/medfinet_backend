const assert = require('node:assert/strict');
const test = require('node:test');
const { createEmergencyAccessService } = require('../services/emergencyAccessService');

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
    role: 'EMERGENCY_COORDINATOR',
    purpose: 'emergency-continuity',
    authenticatedAt: new Date('2026-07-28T12:00:00.000Z'),
    requestId: 'request-1',
    ...overrides,
  };
}

function transaction(overrides = {}) {
  return {
    async $executeRawUnsafe() {},
    outboxEvent: { async create() {} },
    ...overrides,
  };
}

test('activates bounded emergency access after step-up authentication', async () => {
  const calls = [];
  const tx = transaction({
    child: {
      async findFirst() {
        return { id: 'child-1' };
      },
    },
    emergencyAccess: {
      async updateMany(input) {
        calls.push(['expire', input]);
      },
      async findFirst() {
        return null;
      },
      async create({ data }) {
        calls.push(['access', data]);
        return { id: 'access-1', ...data };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createEmergencyAccessService(
    databaseWithTransaction(tx),
    { now: () => new Date('2026-07-28T12:02:00.000Z') }
  );

  const access = await service.activate(context(), 'child-1', {
    durationMinutes: 15,
    reasonCode: 'FLOOD_DISPLACEMENT',
    justification: 'Child requires continuity-of-care assessment',
  });

  assert.equal(access.id, 'access-1');
  assert.equal(access.expiresAt.toISOString(), '2026-07-28T12:17:00.000Z');
  assert.equal(calls[1][1].organizationId, 'org-1');
  assert.equal(calls[2][1].action, 'emergency-access.activated');
});

test('rejects emergency access longer than thirty minutes', async () => {
  const service = createEmergencyAccessService(databaseWithTransaction({}));

  await assert.rejects(
    service.activate(context(), 'child-1', {
      durationMinutes: 31,
      reasonCode: 'FLOOD_DISPLACEMENT',
      justification: 'Invalid duration',
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('records denial evidence before rejecting an invalid emergency session', async () => {
  let disclosure;
  const tx = transaction({
    emergencyAccess: {
      async findFirst() {
        return null;
      },
    },
    disclosureEvent: {
      async create({ data }) {
        disclosure = data;
        return { id: 'disclosure-denied', ...data };
      },
    },
  });
  const service = createEmergencyAccessService(databaseWithTransaction(tx));

  await assert.rejects(
    service.getEmergencyProfile(context(), 'child-1', 'expired-access'),
    (error) => (
      error.code === 'EMERGENCY_ACCESS_DENIED'
      && error.details.disclosureEventId === 'disclosure-denied'
    )
  );

  assert.equal(disclosure.decision, 'DENIED');
  assert.equal(disclosure.reasonCode, 'INVALID_EMERGENCY_ACCESS');
  assert.equal(disclosure.requestId, 'request-1');
});

test('returns only the selected emergency profile and records allowed disclosure', async () => {
  const calls = [];
  const tx = transaction({
    emergencyAccess: {
      async findFirst() {
        return {
          id: 'access-1',
          reasonCode: 'FLOOD_DISPLACEMENT',
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        };
      },
    },
    child: {
      async findFirst({ select }) {
        assert.equal(select.medfinetId, true);
        assert.equal(select.immunizations.take, 20);
        assert.equal(select.growthMeasurements.take, 1);
        assert.equal(select.clinicalAlerts.where.emergencyVisible, true);
        return {
          id: 'child-1',
          medfinetId: 'MED-1',
          firstName: 'Amina',
          lastName: 'Musa',
          dateOfBirth: new Date('2024-01-01T00:00:00.000Z'),
          sex: 'FEMALE',
          caregivers: [],
          immunizations: [],
          growthMeasurements: [],
          clinicalAlerts: [],
          appointments: [],
        };
      },
    },
    disclosureEvent: {
      async create({ data }) {
        calls.push(['disclosure', data]);
        return { id: 'disclosure-1', ...data };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createEmergencyAccessService(databaseWithTransaction(tx));

  const result = await service.getEmergencyProfile(context(), 'child-1', 'access-1');

  assert.equal(result.profile.medfinetId, 'MED-1');
  assert.equal(result.disclosureEventId, 'disclosure-1');
  assert.equal(calls[0][1].decision, 'ALLOWED');
  assert.equal(calls[0][1].emergencyAccessId, 'access-1');
  assert.equal(calls[1][1].action, 'emergency-profile.read');
});

test('flagging an active access revokes it and preserves review evidence', async () => {
  const calls = [];
  const tx = transaction({
    emergencyAccess: {
      async findFirst() {
        return {
          id: 'access-1',
          childId: 'child-1',
          actorSubjectId: 'worker-1',
          status: 'ACTIVE',
          reviewStatus: 'PENDING',
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        };
      },
      async update({ data }) {
        calls.push(['update', data]);
        return {
          id: 'access-1',
          childId: 'child-1',
          actorSubjectId: 'worker-1',
          ...data,
        };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createEmergencyAccessService(
    databaseWithTransaction(tx),
    { now: () => new Date('2026-07-28T13:00:00.000Z') }
  );

  const result = await service.review(
    context({ role: 'ADMIN', actorSubjectId: 'admin-1' }),
    'access-1',
    {
      decision: 'FLAGGED',
      reviewNotes: 'Reason was not supported by incident records',
    }
  );

  assert.equal(result.status, 'REVOKED');
  assert.equal(result.reviewStatus, 'FLAGGED');
  assert.equal(calls[0][1].revokedBySubjectId, 'admin-1');
  assert.equal(calls[1][1].metadata.revoked, true);
});
