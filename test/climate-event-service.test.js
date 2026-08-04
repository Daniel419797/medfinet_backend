const assert = require('node:assert/strict');
const test = require('node:test');
const { createClimateEventService } = require('../services/climateEventService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

function context() {
  return {
    organizationId: 'org-1',
    actorSubjectId: 'coordinator-1',
    role: 'EMERGENCY_COORDINATOR',
    purpose: 'climate-response',
  };
}

function transaction(overrides = {}) {
  return { async $executeRawUnsafe() {}, ...overrides };
}

test('upserts a tenant-bound climate profile and audits the assessment', async () => {
  const calls = [];
  const tx = transaction({
    child: {
      async findFirst({ where }) {
        assert.equal(where.organizationId, 'org-1');
        return { id: 'child-1' };
      },
    },
    climateProfile: {
      async upsert(input) {
        calls.push(['profile', input]);
        return { id: 'profile-1', ...input.create };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createClimateEventService(databaseWithTransaction(tx));

  const profile = await service.upsertClimateProfile(context(), 'child-1', {
    administrativeAreaCode: 'lag-ikeja',
    vulnerability: 'HIGH',
    displaced: true,
    shelterCode: 'SHELTER-1',
    assessedAt: '2026-07-28T10:00:00.000Z',
  });

  assert.equal(profile.administrativeAreaCode, 'LAG-IKEJA');
  assert.equal(calls[0][1].where.childId_organizationId.organizationId, 'org-1');
  assert.equal(calls[1][1].action, 'climate-profile.assessed');
});

test('requires an affected area before activating a climate event', async () => {
  const tx = transaction({
    climateEvent: {
      async findFirst() {
        return { id: 'event-1', status: 'DRAFT', endsAt: null };
      },
    },
    affectedArea: {
      async count() {
        return 0;
      },
    },
  });
  const service = createClimateEventService(databaseWithTransaction(tx));

  await assert.rejects(
    service.transitionEvent(context(), 'event-1', { status: 'ACTIVE' }),
    (error) => error.code === 'AFFECTED_AREA_REQUIRED'
  );
});

test('activates a climate event with an affected area and writes audit evidence', async () => {
  const calls = [];
  const tx = transaction({
    climateEvent: {
      async findFirst() {
        return { id: 'event-1', status: 'DRAFT', endsAt: null };
      },
      async update({ data }) {
        calls.push(['update', data]);
        return { id: 'event-1', ...data };
      },
    },
    affectedArea: {
      async count() {
        return 1;
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createClimateEventService(
    databaseWithTransaction(tx),
    { now: () => new Date('2026-07-28T12:00:00.000Z') }
  );

  const event = await service.transitionEvent(context(), 'event-1', { status: 'ACTIVE' });

  assert.equal(event.status, 'ACTIVE');
  assert.equal(event.activatedAt.toISOString(), '2026-07-28T12:00:00.000Z');
  assert.equal(calls[1][1].action, 'climate-event.status-changed');
});
