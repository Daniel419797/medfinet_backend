const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const {
  CERTIFICATE_TEMPLATE_PATH,
  renderCertificate,
} = require('../controllers/certificate/certificate');
const { createCertificateService } = require('../services/certificateService');

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'subject-1',
  membershipId: 'membership-1',
  role: 'CAREGIVER',
  scopeMode: 'GLOBAL',
  purpose: 'vaccination-certificate-download',
};

test('renders the official template as a private PNG with child data and a fresh QR', async () => {
  const certificate = await renderCertificate({
    childName: 'Amina Okafor',
    childDOB: '2021-04-18',
    sex: 'FEMALE',
    state: 'Lagos',
    location: 'Medfinet Community Clinic',
    vaccineCode: 'MEASLES',
    doseNumber: 1,
    verificationValue: 'MEDFINET-TEST-CERTIFICATE',
  });

  const [certificateMetadata, templateMetadata] = await Promise.all([
    sharp(certificate).metadata(),
    sharp(CERTIFICATE_TEMPLATE_PATH).metadata(),
  ]);
  assert.equal(certificateMetadata.format, 'png');
  assert.equal(certificateMetadata.width, 853);
  assert.equal(certificateMetadata.height, 1280);
  assert.equal(certificateMetadata.width, templateMetadata.width);
  assert.equal(certificateMetadata.height, templateMetadata.height);
  assert.ok(certificate.length > 100_000);
});

test('loads a tenant-scoped immunization and returns a PNG without publishing child data', async () => {
  const auditEvents = [];
  let renderedData;
  const transaction = {
    $executeRawUnsafe: async () => undefined,
    immunizationRecord: {
      findFirst: async ({ where }) => {
        assert.equal(where.organizationId, context.organizationId);
        assert.equal(where.childId, 'child-1');
        assert.equal(where.id, 'imm-1');
        return {
          id: 'imm-1',
          organizationId: 'org-1',
          childId: 'child-1',
          facilityId: 'facility-1',
          programmeId: null,
          vaccineCode: 'BCG',
          doseNumber: 1,
          administeredAt: new Date('2026-01-10T08:00:00.000Z'),
          updatedAt: new Date('2026-01-10T08:00:00.000Z'),
          child: {
            firstName: 'Amina',
            lastName: 'Okafor',
            dateOfBirth: new Date('2021-04-18T00:00:00.000Z'),
            sex: 'FEMALE',
            medfinetId: 'MF-0001',
          },
          facility: {
            name: 'Community Clinic',
            administrativeArea: 'Lagos',
          },
        };
      },
    },
    auditEvent: {
      create: async ({ data }) => {
        auditEvents.push(data);
        return data;
      },
    },
  };
  const database = { $transaction: async (operation) => operation(transaction) };
  const renderer = async (data) => {
    renderedData = data;
    return Buffer.from('private-png');
  };

  const result = await createCertificateService(database, renderer).create(
    context,
    'child-1',
    'imm-1',
  );

  assert.equal(result.filename, 'MF-0001-BCG-vaccination-certificate.png');
  assert.equal(result.buffer.toString(), 'private-png');
  assert.equal(renderedData.childName, 'Amina Okafor');
  const qrPayload = JSON.parse(renderedData.verificationValue);
  assert.deepEqual(Object.keys(qrPayload).sort(), [
    'algorandAnchorId',
    'fingerprint',
    'fingerprintVersion',
    'recordId',
    'type',
    'version',
  ]);
  assert.equal(qrPayload.recordId, 'imm-1');
  assert.equal(qrPayload.version, 3);
  assert.equal(qrPayload.fingerprintVersion, 1);
  assert.match(
    qrPayload.algorandAnchorId,
    /^immunization-recorded:v1:imm-1:[a-f0-9]{64}$/,
  );
  assert.equal(auditEvents[0].action, 'immunization-certificate.downloaded');
});

test('queues an Algorand fingerprint anchor without publishing clinical data', async () => {
  let queued;
  const auditEvents = [];
  const transaction = {
    $executeRawUnsafe: async () => undefined,
    immunizationRecord: {
      findFirst: async () => ({
        id: 'imm-1',
        organizationId: 'org-1',
        childId: 'child-1',
        facilityId: null,
        programmeId: null,
        vaccineCode: 'BCG',
        doseNumber: 1,
        administeredAt: new Date('2026-01-10T08:00:00.000Z'),
        status: 'ACTIVE',
        updatedAt: new Date('2026-01-10T08:00:00.000Z'),
        child: { firstName: 'Amina', lastName: 'Okafor' },
        facility: null,
      }),
    },
    anchorReceipt: { findFirst: async () => null },
    outboxEvent: {
      findUnique: async () => null,
      upsert: async ({ create }) => { queued = create; return create; },
    },
    auditEvent: {
      create: async ({ data }) => { auditEvents.push(data); return data; },
    },
  };
  const database = { $transaction: async (operation) => operation(transaction) };
  const service = createCertificateService(database, async () => Buffer.alloc(0), {
    algorand: {
      enabled: true,
      algodServer: 'not-a-valid-url',
    },
  });

  const result = await service.evidence(context, 'child-1', 'imm-1');

  assert.equal(result.status, 'PENDING');
  assert.equal(result.queued, true);
  assert.equal(result.network, 'Algorand');
  assert.equal(queued.payload.eventCode, 0x09);
  assert.match(
    queued.payload.anchorId,
    /^immunization-recorded:v1:imm-1:[a-f0-9]{64}$/,
  );
  assert.equal(result.fingerprintVersion, 1);
  assert.equal(queued.idempotencyKey, 'blockchain:9:v1:imm-1');
  assert.equal(JSON.stringify(queued.payload).includes('Amina'), false);
  assert.equal(JSON.stringify(queued.payload).includes('BCG'), false);
  assert.equal(auditEvents[0].action, 'immunization-certificate.evidence-viewed');
  assert.equal(auditEvents[0].entityId, 'imm-1');
  assert.equal(auditEvents[0].metadata.childId, 'child-1');
  assert.equal(auditEvents[0].metadata.anchorId, queued.payload.anchorId);
});

test('uses the latest amendment anchor for an amended certificate', async () => {
  let queued;
  const transaction = {
    $executeRawUnsafe: async () => undefined,
    immunizationRecord: {
      findFirst: async () => ({
        id: 'imm-1',
        organizationId: 'org-1',
        childId: 'child-1',
        facilityId: null,
        programmeId: null,
        vaccineCode: 'BCG',
        doseNumber: 1,
        administeredAt: new Date('2026-01-10T08:00:00.000Z'),
        status: 'AMENDED',
        child: { firstName: 'Amina', lastName: 'Okafor' },
        facility: null,
        amendments: [{
          id: 'amendment-1',
          reason: 'Corrected the lot number',
          previousData: { lotNumber: 'LOT-OLD' },
          replacementData: { lotNumber: 'LOT-NEW' },
        }],
      }),
    },
    anchorReceipt: { findFirst: async () => null },
    outboxEvent: {
      findUnique: async () => null,
      upsert: async ({ create }) => { queued = create; return create; },
    },
    auditEvent: { create: async ({ data }) => data },
  };
  const database = { $transaction: async (operation) => operation(transaction) };
  const service = createCertificateService(database, async () => Buffer.alloc(0), {
    algorand: {
      enabled: true,
      algodServer: 'https://testnet-api.algonode.cloud',
    },
  });

  const result = await service.evidence(context, 'child-1', 'imm-1');

  assert.equal(queued.payload.eventCode, 0x0A);
  assert.equal(queued.aggregateId, 'amendment-1');
  assert.match(
    queued.payload.anchorId,
    /^immunization-amended:v1:amendment-1:[a-f0-9]{64}$/,
  );
  assert.equal(result.fingerprint, queued.payload.anchorId.split(':').at(-1));
});

test('reports confirmed evidence only after the Algorand note is verified', async () => {
  const transaction = {
    $executeRawUnsafe: async () => undefined,
    immunizationRecord: {
      findFirst: async () => ({
        id: 'imm-1',
        organizationId: 'org-1',
        childId: 'child-1',
        facilityId: null,
        programmeId: null,
        vaccineCode: 'BCG',
        doseNumber: 1,
        administeredAt: new Date('2026-01-10T08:00:00.000Z'),
        status: 'ACTIVE',
        updatedAt: new Date('2026-01-10T08:00:00.000Z'),
        child: { firstName: 'Amina', lastName: 'Okafor' },
        facility: null,
      }),
    },
    anchorReceipt: {
      findFirst: async ({ where }) => ({
        anchorId: where.anchorId,
        eventCode: 0x09,
        eventCategory: 'clinical',
        tenantId: 'org-1',
        txId: 'ALGORAND-TX-1',
        blockHeight: 42n,
        isoTimestamp: '2026-01-10T08:01:00.000Z',
        nonce: '0011223344556677',
        hashHex: 'a'.repeat(64),
        confirmations: 4,
        submittedAt: new Date('2026-01-10T08:01:00.000Z'),
        confirmedAt: new Date('2026-01-10T08:02:00.000Z'),
        status: 'confirmed',
      }),
    },
    auditEvent: { create: async ({ data }) => data },
  };
  const database = { $transaction: async (operation) => operation(transaction) };
  const service = createCertificateService(database, async () => Buffer.alloc(0), {
    algorand: {
      enabled: true,
      algodServer: 'https://testnet-api.algonode.cloud',
    },
    inspectReceipt: async (_receipt, _settings, expected) => {
      assert.deepEqual(expected, {
        anchorId: expected.anchorId,
        eventCode: 0x09,
        tenantId: 'org-1',
      });
      return ({
      receiptIntegrity: true,
      hashIntegrity: true,
      txIdIntegrity: true,
      noteIntegrity: true,
      transactionIntegrity: true,
      chainConfirmed: true,
      verified: true,
      network: 'Algorand TestNet',
      networkId: 'testnet',
      explorerUrl: 'https://testnet.explorer.perawallet.app/tx/ALGORAND-TX-1',
      });
    },
  });

  const result = await service.evidence(context, 'child-1', 'imm-1');

  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.chainConfirmed, true);
  assert.equal(result.noteIntegrity, true);
  assert.equal(result.txId, 'ALGORAND-TX-1');
  assert.equal(result.blockHeight, '42');
});

function evidenceRecord() {
  return {
    id: 'imm-1',
    organizationId: 'org-1',
    childId: 'child-1',
    facilityId: null,
    programmeId: null,
    vaccineCode: 'BCG',
    doseNumber: 1,
    administeredAt: new Date('2026-01-10T08:00:00.000Z'),
    status: 'ACTIVE',
    administeringSubjectId: 'worker-1',
    child: { firstName: 'Amina', lastName: 'Okafor' },
    facility: null,
  };
}

function recoveryTransaction(existing, onUpdateMany) {
  return {
    $executeRawUnsafe: async () => undefined,
    immunizationRecord: { findFirst: async () => evidenceRecord() },
    anchorReceipt: { findFirst: async () => null },
    outboxEvent: {
      findUnique: async () => existing,
      upsert: async () => {
        throw new Error('existing evidence must not be inserted again');
      },
      updateMany: onUpdateMany,
    },
    auditEvent: { create: async ({ data }) => data },
  };
}

test('atomically requeues legacy published evidence when no receipt exists', async () => {
  const existing = {
    id: 'outbox-1',
    organizationId: 'org-1',
    status: 'PUBLISHED',
    attempts: 1,
  };
  let recovery;
  const transaction = recoveryTransaction(existing, async (input) => {
    recovery = input;
    return { count: 1 };
  });
  const database = { $transaction: async (operation) => operation(transaction) };
  const service = createCertificateService(database, async () => Buffer.alloc(0), {
    algorand: { enabled: true, algodServer: 'invalid' },
  });

  const result = await service.evidence(context, 'child-1', 'imm-1');

  assert.equal(result.status, 'PENDING');
  assert.equal(result.queued, true);
  assert.deepEqual(recovery.where, {
    id: 'outbox-1',
    organizationId: 'org-1',
    status: 'PUBLISHED',
    attempts: 1,
  });
  assert.equal(recovery.data.status, 'PENDING');
});

test('never resets evidence while an outbox worker owns the processing lock', async () => {
  const existing = {
    id: 'outbox-1',
    organizationId: 'org-1',
    status: 'PROCESSING',
    attempts: 2,
    lockedBy: 'worker-1',
  };
  let updated = false;
  const transaction = recoveryTransaction(existing, async () => {
    updated = true;
    return { count: 1 };
  });
  const database = { $transaction: async (operation) => operation(transaction) };
  const service = createCertificateService(database, async () => Buffer.alloc(0), {
    algorand: { enabled: true, algodServer: 'invalid' },
  });

  const result = await service.evidence(context, 'child-1', 'imm-1');

  assert.equal(result.queued, false);
  assert.equal(updated, false);
});
