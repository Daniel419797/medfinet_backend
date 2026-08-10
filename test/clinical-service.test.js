const assert = require('node:assert/strict');
const test = require('node:test');
const { createClinicalService } = require('../services/clinicalService');
const { createCredentialService } = require('../services/credentialService');
const { tokenDigest } = require('../services/clinicalValidation');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

function context(organizationId = 'org-1') {
  return {
    organizationId,
    actorSubjectId: 'worker-1',
    role: 'HEALTH_WORKER',
    purpose: 'continuity-of-care',
  };
}

function tenantTransaction(overrides = {}) {
  return {
    async $executeRawUnsafe() {},
    outboxEvent: { async create() {} },
    ...overrides,
  };
}

test('records one vaccine dose with worker attribution, deduplication, audit, and hash-only anchoring', async () => {
  const calls = [];
  const transaction = tenantTransaction({
    child: {
      async findFirst() {
        return { id: 'child-1', medfinetId: 'MED-1' };
      },
    },
    immunizationRecord: {
      async findUnique() {
        return null;
      },
      async findFirst() {
        return null;
      },
      async create({ data }) {
        calls.push(['immunization', data]);
        return { id: 'immunization-1', status: 'ACTIVE', ...data };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
    outboxEvent: {
      async create({ data }) {
        calls.push(['outbox', data]);
      },
    },
  });
  const service = createClinicalService(databaseWithTransaction(transaction));

  const record = await service.recordImmunization(context(), 'child-1', {
    vaccineCode: ' bcg ',
    doseNumber: 1,
    administeredAt: '2026-01-01T10:00:00.000Z',
    lotNumber: 'LOT-1',
    sourceOperationId: 'operation-1',
  });

  assert.equal(record.vaccineCode, 'BCG');
  assert.equal(record.administeringSubjectId, 'worker-1');
  assert.equal(record.deduplicationKey, undefined);
  assert.match(
    calls.find(([kind]) => kind === 'immunization')[1].deduplicationKey,
    /^[a-f0-9]{64}$/
  );
  assert.equal(calls.find(([kind]) => kind === 'audit')[1].action, 'immunization.recorded');
  const anchor = calls.find(([kind]) => kind === 'outbox')[1];
  assert.equal(anchor.eventType, 'BLOCKCHAIN_ANCHOR_REQUESTED');
  assert.equal(anchor.payload.eventCode, 0x09);
  assert.match(anchor.payload.anchorId, /^immunization-recorded:immunization-1:[a-f0-9]{64}$/);
  assert.doesNotMatch(anchor.payload.anchorId, /BCG|LOT-1|child-1/);
});

test('rejects a duplicate vaccine and dose for the same child', async () => {
  const transaction = tenantTransaction({
    child: {
      async findFirst() {
        return { id: 'child-1' };
      },
    },
    immunizationRecord: {
      async findFirst() {
        return { id: 'immunization-existing' };
      },
    },
  });
  const service = createClinicalService(databaseWithTransaction(transaction));

  await assert.rejects(
    service.recordImmunization(context(), 'child-1', {
      vaccineCode: 'BCG',
      doseNumber: 1,
      administeredAt: '2026-01-01T10:00:00.000Z',
    }),
    (error) => error.code === 'IMMUNIZATION_ALREADY_RECORDED' && error.status === 409
  );
});

test('rejects immunization writes from a non-clinical role before database access', async () => {
  let transactionStarted = false;
  const database = {
    async $transaction() {
      transactionStarted = true;
    },
  };
  const service = createClinicalService(database);

  await assert.rejects(
    service.recordImmunization(
      { ...context(), role: 'NUTRITION_WORKER' },
      'child-1',
      {
        vaccineCode: 'BCG',
        doseNumber: 1,
        administeredAt: '2026-01-01T10:00:00.000Z',
      }
    ),
    (error) => error.code === 'CLINICAL_WRITE_ACCESS_DENIED' && error.status === 403
  );
  assert.equal(transactionStarted, false);
});

test('replaces an active credential without changing the child identity', async () => {
  const calls = [];
  const transaction = tenantTransaction({
    childCredential: {
      async findFirst({ where }) {
        assert.deepEqual(where, { id: 'credential-old', organizationId: 'org-1' });
        return {
          id: 'credential-old',
          organizationId: 'org-1',
          childId: 'child-1',
          status: 'ACTIVE',
        };
      },
      async update({ data }) {
        calls.push(['update', data]);
        return { id: 'credential-old', ...data };
      },
      async create({ data }) {
        calls.push(['create', data]);
        return { id: 'credential-new', status: 'ACTIVE', ...data };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createCredentialService(databaseWithTransaction(transaction));

  const result = await service.replace(context(), 'credential-old', {
    kind: 'QR',
    reason: 'Card was lost',
  });

  assert.equal(calls[0][1].status, 'ROTATED');
  assert.equal(calls[1][1].childId, 'child-1');
  assert.equal(calls[1][1].replacesCredentialId, 'credential-old');
  assert.equal(calls[1][1].tokenHash, tokenDigest(result.token));
  assert.equal(calls[2][1].action, 'credential.replaced');
  assert.equal(calls[2][1].purpose, 'continuity-of-care');
  assert.equal(result.credential.childId, 'child-1');
  assert.equal(Object.hasOwn(result.credential, 'tokenHash'), false);
});

test('does not replace a revoked credential', async () => {
  const transaction = tenantTransaction({
    childCredential: {
      async findFirst() {
        return { id: 'credential-old', childId: 'child-1', status: 'REVOKED' };
      },
    },
  });
  const service = createCredentialService(databaseWithTransaction(transaction));

  await assert.rejects(
    service.replace(context(), 'credential-old', {
      kind: 'QR',
      reason: 'Replacement attempt',
    }),
    (error) => error.code === 'CREDENTIAL_NOT_ACTIVE' && error.status === 409
  );
});

test('schedules an appointment inside the verified tenant and writes audit evidence', async () => {
  const calls = [];
  const transaction = tenantTransaction({
    child: {
      async findFirst({ where }) {
        assert.equal(where.organizationId, 'org-1');
        return { id: 'child-1', medfinetId: 'MED-1' };
      },
    },
    appointment: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        calls.push(['appointment', data]);
        return { id: 'appointment-1', status: 'SCHEDULED', ...data };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createClinicalService(databaseWithTransaction(transaction));

  const result = await service.scheduleAppointment(context(), 'child-1', {
    kind: 'ROUTINE_IMMUNIZATION',
    scheduledFor: '2030-01-01T09:00:00.000Z',
    facilityId: 'facility-1',
    sourceOperationId: 'device-operation-1',
  });

  assert.equal(calls[0][1].organizationId, 'org-1');
  assert.equal(calls[0][1].childId, 'child-1');
  assert.equal(calls[0][1].sourceOperationId, 'device-operation-1');
  assert.equal(calls[1][1].action, 'appointment.scheduled');
  assert.equal(result.status, 'SCHEDULED');
});

test('replays an appointment source operation only for the same child', async () => {
  const replay = {
    id: 'appointment-existing',
    organizationId: 'org-1',
    childId: 'child-1',
    sourceOperationId: 'device-operation-1',
    status: 'SCHEDULED',
  };
  const transaction = tenantTransaction({
    appointment: {
      async findUnique() {
        return replay;
      },
    },
  });
  const service = createClinicalService(databaseWithTransaction(transaction));

  const result = await service.scheduleAppointment(context(), 'child-1', {
    kind: 'ROUTINE_IMMUNIZATION',
    scheduledFor: '2030-01-01T09:00:00.000Z',
    sourceOperationId: 'device-operation-1',
  });

  assert.equal(result, replay);

  await assert.rejects(
    service.scheduleAppointment(context(), 'child-other', {
      kind: 'ROUTINE_IMMUNIZATION',
      scheduledFor: '2030-01-01T09:00:00.000Z',
      sourceOperationId: 'device-operation-1',
    }),
    (error) => error.code === 'IDEMPOTENCY_KEY_REUSED' && error.status === 409
  );
});

test('allows a scheduled appointment to complete exactly once', async () => {
  const calls = [];
  const transaction = tenantTransaction({
    appointment: {
      async findFirst() {
        return {
          id: 'appointment-1',
          organizationId: 'org-1',
          childId: 'child-1',
          status: 'SCHEDULED',
        };
      },
      async update({ data }) {
        calls.push(['update', data]);
        return {
          id: 'appointment-1',
          childId: 'child-1',
          status: data.status,
        };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createClinicalService(databaseWithTransaction(transaction));

  const result = await service.updateAppointmentStatus(context(), 'appointment-1', {
    status: 'COMPLETED',
  });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(calls[1][1].metadata.from, 'SCHEDULED');
  assert.equal(calls[1][1].metadata.to, 'COMPLETED');
});

test('rejects terminal appointment status transitions', async () => {
  const transaction = tenantTransaction({
    appointment: {
      async findFirst() {
        return {
          id: 'appointment-1',
          organizationId: 'org-1',
          childId: 'child-1',
          status: 'COMPLETED',
        };
      },
    },
  });
  const service = createClinicalService(databaseWithTransaction(transaction));

  await assert.rejects(
    service.updateAppointmentStatus(context(), 'appointment-1', { status: 'CANCELLED' }),
    (error) => error.code === 'INVALID_APPOINTMENT_TRANSITION' && error.status === 409
  );
});
