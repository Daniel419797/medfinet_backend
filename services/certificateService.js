const crypto = require('node:crypto');
const { renderCertificate } = require('../controllers/certificate/certificate');
const { DomainError } = require('../utils/domainError');
const { audit } = require('./clinicalValidation');
const { assertResourceScope } = require('./resourceScopeService');
const { withTenantTransaction } = require('./tenantContext');

function safeFilenamePart(value) {
  return String(value || 'record')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'record';
}

function certificateFingerprint(record) {
  const version = record.updatedAt instanceof Date
    ? record.updatedAt.toISOString()
    : String(record.updatedAt || record.createdAt || '');
  return crypto
    .createHash('sha256')
    .update([
      record.organizationId,
      record.childId,
      record.id,
      record.vaccineCode,
      record.doseNumber,
      record.administeredAt instanceof Date
        ? record.administeredAt.toISOString()
        : String(record.administeredAt),
      version,
    ].join(':'))
    .digest('hex');
}

function createCertificateService(prismaClient, renderer = renderCertificate) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function create(context, childId, immunizationId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const record = await transaction.immunizationRecord.findFirst({
        where: {
          id: immunizationId,
          childId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          child: { status: 'ACTIVE' },
        },
        include: {
          child: {
            select: {
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              sex: true,
              medfinetId: true,
            },
          },
          facility: {
            select: {
              name: true,
              administrativeArea: true,
            },
          },
        },
      });

      if (!record) {
        throw new DomainError(
          404,
          'IMMUNIZATION_CERTIFICATE_NOT_FOUND',
          'Active immunization record not found',
        );
      }

      await assertResourceScope(transaction, context, {
        facilityId: record.facilityId,
        programmeId: record.programmeId,
      });

      const fingerprint = certificateFingerprint(record);
      const verificationValue = JSON.stringify({
        type: 'MEDFINET_VACCINATION_CERTIFICATE',
        version: 1,
        recordId: record.id,
        fingerprint,
      });
      const buffer = await renderer({
        childName: `${record.child.firstName} ${record.child.lastName}`,
        childDOB: record.child.dateOfBirth,
        sex: record.child.sex,
        state: record.facility?.administrativeArea || '',
        location: record.facility?.name || '',
        vaccineCode: record.vaccineCode,
        doseNumber: record.doseNumber,
        verificationValue,
      });

      await transaction.auditEvent.create({
        data: audit(
          context,
          'immunization-certificate.downloaded',
          'immunization',
          record.id,
          { childId, fingerprint },
        ),
      });

      return {
        buffer,
        filename: [
          safeFilenamePart(record.child.medfinetId),
          safeFilenamePart(record.vaccineCode),
          'vaccination-certificate.png',
        ].join('-'),
      };
    });
  }

  return { create };
}

module.exports = {
  certificateFingerprint,
  createCertificateService,
  safeFilenamePart,
};
