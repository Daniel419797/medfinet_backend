const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createClinicalLifecycleService,
} = require('../services/clinicalLifecycleService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'worker-1',
  purpose: 'clinical-care',
};

test('records an idempotent tenant-bound allergy', async () => {
  let createData;
  const tx = {
    async $executeRawUnsafe() {},
    child: {
      async findFirst() {
        return { id: 'child-1' };
      },
    },
    allergyRecord: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        createData = data;
        return { id: 'allergy-1', status: 'ACTIVE', ...data };
      },
    },
    auditEvent: { async create() {} },
  };
  const allergy = await createClinicalLifecycleService(
    databaseWithTransaction(tx)
  ).recordAllergy(context, 'child-1', {
    substanceCode: '227493005',
    substanceDisplay: 'Cashew nut',
    reaction: 'Hives',
    severity: 'HIGH',
    criticality: 'HIGH',
    sourceOperationId: 'allergy-operation-1',
  });

  assert.equal(allergy.id, 'allergy-1');
  assert.equal(createData.organizationId, 'org-1');
  assert.equal(createData.recordedBySubjectId, 'worker-1');
});

test('resolves an active alert exactly once with audit evidence', async () => {
  let updateData;
  let audit;
  const tx = {
    async $executeRawUnsafe() {},
    clinicalAlert: {
      async updateMany({ data }) {
        updateData = data;
        return { count: 1 };
      },
      async findUnique() {
        return { id: 'alert-1', ...updateData };
      },
    },
    auditEvent: {
      async create({ data }) {
        audit = data;
      },
    },
  };
  const alert = await createClinicalLifecycleService(
    databaseWithTransaction(tx)
  ).resolveAlert(context, 'alert-1', {
    status: 'RESOLVED',
    reason: 'Condition clinically resolved',
  });

  assert.equal(alert.status, 'RESOLVED');
  assert.equal(audit.action, 'clinical-alert.status-changed');
});

test('amends immunization while preserving immutable before-and-after evidence', async () => {
  let amendment;
  const existing = {
    id: 'immunization-1',
    vaccineCode: 'OPV',
    doseNumber: 1,
    administeredAt: new Date('2026-01-01T00:00:00.000Z'),
    lotNumber: 'LOT-OLD',
    route: 'ORAL',
    site: null,
    notes: null,
  };
  const tx = {
    async $executeRawUnsafe() {},
    immunizationRecord: {
      async findFirst() {
        return existing;
      },
      async update({ data }) {
        return { ...existing, ...data };
      },
    },
    clinicalAmendment: {
      async create({ data }) {
        amendment = data;
      },
    },
    auditEvent: { async create() {} },
  };

  const record = await createClinicalLifecycleService(
    databaseWithTransaction(tx)
  ).amendImmunization(context, 'immunization-1', {
    reason: 'Corrected transcribed lot number',
    lotNumber: 'LOT-NEW',
  });

  assert.equal(record.status, 'AMENDED');
  assert.equal(amendment.previousData.lotNumber, 'LOT-OLD');
  assert.equal(amendment.replacementData.lotNumber, 'LOT-NEW');
});
