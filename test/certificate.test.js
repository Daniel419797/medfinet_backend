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
  assert.deepEqual(Object.keys(qrPayload).sort(), ['fingerprint', 'recordId', 'type', 'version']);
  assert.equal(qrPayload.recordId, 'imm-1');
  assert.equal(auditEvents[0].action, 'immunization-certificate.downloaded');
});
