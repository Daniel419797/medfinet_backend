const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createImmunizationAmendmentService,
} = require('../services/immunizationAmendmentService');

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
    actorSubjectId: 'admin-1',
    actorDisplayName: 'Admin One',
    role: 'ADMIN',
    purpose: 'immunization-amendment',
  };
}

test('completes a legacy certificate through an audited v2 amendment without rewriting the original recorder', async () => {
  const calls = [];
  const existing = {
    id: 'imm-1',
    organizationId: 'org-1',
    childId: 'child-1',
    facilityId: 'facility-1',
    programmeId: null,
    vaccineCode: 'BCG',
    doseNumber: 1,
    administeredAt: new Date('2026-01-01T10:00:00.000Z'),
    lotNumber: 'LOT-1',
    route: 'ID',
    site: 'LEFT_ARM',
    notes: null,
    administeringSubjectId: 'original-recorder',
    status: 'ACTIVE',
  };
  const transaction = {
    async $executeRawUnsafe() {},
    facility: {
      async findFirst() {
        return {
          id: 'facility-1',
          name: 'Dennis Primary Health Centre',
          administrativeArea: 'Delta',
          isActive: true,
        };
      },
    },
    immunizationRecord: {
      async findFirst({ where }) {
        if (where.id?.not) return null;
        return existing;
      },
      async update({ data }) {
        calls.push(['record-update', data]);
        return { ...existing, ...data };
      },
    },
    clinicalAmendment: {
      async create({ data }) {
        calls.push(['amendment', data]);
        return { id: 'amendment-1', ...data };
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
  };

  const service = createImmunizationAmendmentService(
    databaseWithTransaction(transaction)
  );
  const result = await service.amend(context(), 'imm-1', {
    reason: 'Verified original vaccination register',
    facilityId: 'facility-1',
    facilityName: 'Dennis Primary Health Centre',
    state: 'Delta',
    lga: 'Uvwie',
    ward: 'Ekpan',
    vaccinatorMode: 'OTHER',
    vaccinatorName: 'Nurse Ada Okafor',
  });

  assert.equal(result.status, 'AMENDED');
  assert.equal(result.certificateMetadata.recordedBySubjectId, 'original-recorder');
  assert.equal(result.certificateMetadata.vaccinatorName, 'Nurse Ada Okafor');
  assert.equal(result.certificateMetadata.vaccinatorSubjectId, null);

  const amendment = calls.find(([kind]) => kind === 'amendment')[1];
  assert.equal(
    Object.prototype.hasOwnProperty.call(amendment.previousData, 'certificateMetadata'),
    false
  );
  assert.equal(
    amendment.replacementData.certificateMetadata.recordedBySubjectId,
    'original-recorder'
  );
  assert.equal(
    amendment.replacementData.certificateMetadata.vaccinatorName,
    'Nurse Ada Okafor'
  );
  assert.equal(
    amendment.replacementData.certificateMetadata.facilityName,
    'Dennis Primary Health Centre'
  );

  const outbox = calls.find(([kind]) => kind === 'outbox')[1];
  assert.equal(outbox.eventType, 'BLOCKCHAIN_ANCHOR_REQUESTED');
  assert.equal(outbox.payload.eventCode, 0x0A);
  assert.match(
    outbox.payload.anchorId,
    /^immunization-amended:v2:amendment-1:[a-f0-9]{64}$/
  );
  assert.equal(outbox.idempotencyKey, 'blockchain:10:v2:amendment-1');

  const audit = calls.find(([kind]) => kind === 'audit')[1];
  assert.equal(audit.action, 'immunization.amended');
  assert.equal(audit.metadata.certificateMetadataChanged, true);
});
