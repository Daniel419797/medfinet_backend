const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createWorklistService,
  normalizeAreaCodes,
  vulnerabilityRange,
} = require('../services/worklistService');
const {
  createWorklistGenerationService,
} = require('../services/worklistGenerationService');

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
    actorSubjectId: 'coordinator-1',
    role: 'EMERGENCY_COORDINATOR',
    purpose: 'climate-response',
    ...overrides,
  };
}

function transaction(overrides = {}) {
  return { async $executeRawUnsafe() {}, ...overrides };
}

test('normalizes unique areas and calculates minimum vulnerability ranges', () => {
  assert.deepEqual(normalizeAreaCodes([' lag-ikeja ', 'LAG-IKEJA']), ['LAG-IKEJA']);
  assert.deepEqual(vulnerabilityRange('HIGH'), ['HIGH', 'CRITICAL']);
});

test('creates a draft worklist only for active event areas and programme', async () => {
  const calls = [];
  const tx = transaction({
    climateEvent: {
      async findFirst() {
        return { id: 'event-1' };
      },
    },
    programme: {
      async findFirst() {
        return { id: 'programme-1' };
      },
    },
    affectedArea: {
      async count({ where }) {
        assert.deepEqual(where.administrativeAreaCode.in, ['LAG-IKEJA']);
        return 1;
      },
    },
    beneficiaryWorklist: {
      async create({ data }) {
        calls.push(['worklist', data]);
        return { id: 'worklist-1', status: 'DRAFT', ...data };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createWorklistService(databaseWithTransaction(tx));

  const worklist = await service.createWorklist(context(), 'event-1', {
    programmeId: 'programme-1',
    name: 'Ikeja flood outreach',
    authorizationBasis: 'Approved emergency response programme',
    administrativeAreaCodes: ['lag-ikeja'],
    minimumVulnerability: 'HIGH',
    displacedOnly: true,
  });

  assert.equal(worklist.criteria.minimumVulnerability, 'HIGH');
  assert.equal(worklist.criteria.displacedOnly, true);
  assert.equal(calls[1][1].action, 'worklist.created');
});

test('queues worklist generation idempotently through the outbox', async () => {
  const calls = [];
  const tx = transaction({
    beneficiaryWorklist: {
      async findFirst() {
        return {
          id: 'worklist-1',
          status: 'DRAFT',
          generationComplete: false,
        };
      },
    },
    outboxEvent: {
      async upsert(input) {
        calls.push(['outbox', input]);
        return { id: 'outbox-1' };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createWorklistGenerationService(databaseWithTransaction(tx));

  const result = await service.requestGeneration(context(), 'worklist-1');

  assert.deepEqual(result, {
    worklistId: 'worklist-1',
    outboxEventId: 'outbox-1',
    scoringPolicyVersion: 'climate-worklist-risk-v1',
  });
  assert.equal(
    calls[0][1].create.eventType,
    'WORKLIST_GENERATION_REQUESTED'
  );
  assert.equal(calls[1][1].action, 'worklist.generation-requested');
});

test('generates large worklists in durable cursor-based batches', async () => {
  const profiles = Array.from({ length: 501 }, (_, index) => ({
    childId: `child-${String(index).padStart(4, '0')}`,
    vulnerability: 'HIGH',
    administrativeAreaCode: 'LAG-IKEJA',
  }));
  const calls = [];
  const tx = transaction({
    beneficiaryWorklist: {
      async findFirst() {
        return {
          id: 'worklist-1',
          status: 'DRAFT',
          generationComplete: false,
          generationCursor: null,
          criteria: {
            administrativeAreaCodes: ['LAG-IKEJA'],
            minimumVulnerability: 'HIGH',
            displacedOnly: false,
          },
        };
      },
      async update({ data }) {
        calls.push(['worklist', data]);
        return { id: 'worklist-1', ...data };
      },
    },
    climateProfile: {
      async findMany({ take }) {
        assert.equal(take, 501);
        return profiles;
      },
    },
    worklistEntry: {
      async createMany({ data }) {
        calls.push(['entries', data]);
        return { count: data.length };
      },
    },
    outboxEvent: {
      async create({ data }) {
        calls.push(['outbox', data]);
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createWorklistGenerationService(databaseWithTransaction(tx));

  const result = await service.processGenerationBatch(context(), 'worklist-1');

  assert.equal(result.batchEntryCount, 500);
  assert.equal(result.generationComplete, false);
  assert.equal(result.nextCursor, 'child-0499');
  assert.equal(calls[0][1].length, 500);
  assert.equal(calls[1][1].generatedCount.increment, 500);
  assert.equal(calls[2][1].eventType, 'WORKLIST_GENERATION_REQUESTED');
  assert.match(calls[2][1].idempotencyKey, /child-0499$/);
});

test('does not authorize an empty generated worklist', async () => {
  const tx = transaction({
    beneficiaryWorklist: {
      async findFirst() {
        return {
          id: 'worklist-1',
          status: 'DRAFT',
          generationComplete: true,
        };
      },
    },
    worklistEntry: {
      async count() {
        return 0;
      },
    },
  });
  const service = createWorklistService(databaseWithTransaction(tx));

  await assert.rejects(
    service.authorizeWorklist(context(), 'worklist-1'),
    (error) => error.code === 'EMPTY_WORKLIST'
  );
});

test('records an idempotent service delivery and activates the worklist', async () => {
  const calls = [];
  const tx = transaction({
    serviceDelivery: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        calls.push(['delivery', data]);
        return { id: 'delivery-1', ...data };
      },
    },
    worklistEntry: {
      async findFirst() {
        return {
          id: 'entry-1',
          childId: 'child-1',
          eligibility: 'ELIGIBLE',
          worklist: { id: 'worklist-1', status: 'AUTHORIZED' },
        };
      },
      async update({ data }) {
        calls.push(['entry', data]);
      },
    },
    beneficiaryWorklist: {
      async update({ data }) {
        calls.push(['worklist', data]);
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createWorklistService(
    databaseWithTransaction(tx),
    { now: () => new Date('2026-07-28T15:00:00.000Z') }
  );

  const result = await service.recordDelivery(context(), 'entry-1', {
    sourceOperationId: 'device-op-1',
    category: 'HYGIENE_KIT',
    quantity: 1,
    unit: 'KIT',
    deliveredAt: '2026-07-28T14:55:00.000Z',
  });

  assert.equal(result.idempotentReplay, false);
  assert.equal(result.delivery.childId, 'child-1');
  assert.equal(calls[1][1].status, 'SERVED');
  assert.equal(calls[2][1].status, 'ACTIVE');
  assert.equal(calls[3][1].action, 'service-delivery.recorded');
});

test('returns an existing service delivery for an idempotent replay', async () => {
  const replay = {
    id: 'delivery-existing',
    organizationId: 'org-1',
    sourceOperationId: 'device-op-1',
  };
  const tx = transaction({
    serviceDelivery: {
      async findUnique() {
        return replay;
      },
    },
  });
  const service = createWorklistService(databaseWithTransaction(tx));

  const result = await service.recordDelivery(context(), 'entry-1', {
    sourceOperationId: 'device-op-1',
  });

  assert.deepEqual(result, { delivery: replay, idempotentReplay: true });
});
