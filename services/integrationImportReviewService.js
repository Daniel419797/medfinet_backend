const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { createIntegrationCrypto } = require('./integrationCrypto');
const { createConsentService } = require('./consentService');
const { createClinicalService } = require('./clinicalService');
const { mapFhirImport } = require('./fhirImportMapper');

function createIntegrationImportReviewService(
  prismaClient,
  { cryptoService, consentService, clinicalService, now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const encryption = cryptoService || createIntegrationCrypto();
  const consent = consentService || createConsentService(database);
  const clinical = clinicalService || createClinicalService(database);

  async function list(context, input = {}) {
    const limit = input.limit === undefined ? 25 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.integrationImportStaging.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.jobId ? { jobId: input.jobId } : {}),
        },
        select: {
          id: true,
          jobId: true,
          recordKey: true,
          externalResourceType: true,
          externalResourceId: true,
          payloadHash: true,
          status: true,
          reviewedBySubjectId: true,
          reviewedAt: true,
          reviewReason: true,
          appliedResourceType: true,
          appliedResourceId: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    });
  }

  async function reveal(context, stagingId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const record = await transaction.integrationImportStaging.findFirst({
        where: { id: stagingId, organizationId: context.organizationId },
      });
      if (!record) {
        throw new DomainError(404, 'INTEGRATION_IMPORT_NOT_FOUND', 'Staged import not found');
      }
      const payload = encryption.decrypt(record);
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'integration-import.revealed',
          entityType: 'integration-import-staging',
          entityId: record.id,
          purpose: context.purpose,
          metadata: { payloadHash: record.payloadHash },
        },
      });
      return {
        id: record.id,
        resourceType: record.externalResourceType,
        payload,
        payloadHash: record.payloadHash,
      };
    });
  }

  async function reject(context, stagingId, input) {
    const reason = requiredText(input.reason, 'reason', 500);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const reviewedAt = now();
      const updated = await transaction.integrationImportStaging.updateMany({
        where: {
          id: stagingId,
          organizationId: context.organizationId,
          status: 'PENDING',
        },
        data: {
          status: 'REJECTED',
          reviewedBySubjectId: context.actorSubjectId,
          reviewedAt,
          reviewReason: reason,
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'INTEGRATION_IMPORT_NOT_REVIEWABLE',
          'Staged import is not pending review'
        );
      }
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'integration-import.rejected',
          entityType: 'integration-import-staging',
          entityId: stagingId,
          purpose: context.purpose,
          metadata: { reason },
        },
      });
      return transaction.integrationImportStaging.findUnique({
        where: { id: stagingId },
      });
    });
  }

  async function markConflict(context, record, error) {
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.integrationImportStaging.update({
        where: { id: record.id },
        data: {
          status: 'CONFLICT',
          reviewedBySubjectId: context.actorSubjectId,
          reviewedAt: now(),
          reviewReason: error.code || 'IMPORT_APPLY_CONFLICT',
        },
      })
    ));
  }

  async function apply(context, stagingId) {
    const record = await withTenantTransaction(
      database,
      context.organizationId,
      (transaction) => transaction.integrationImportStaging.findFirst({
        where: {
          id: stagingId,
          organizationId: context.organizationId,
          status: { in: ['PENDING', 'APPROVED'] },
        },
        include: {
          job: { include: { connection: true } },
        },
      })
    );
    if (!record) {
      throw new DomainError(
        409,
        'INTEGRATION_IMPORT_NOT_APPLICABLE',
        'Staged import is not pending or approved'
      );
    }
    if (record.job.requestedBySubjectId === context.actorSubjectId) {
      throw new DomainError(
        409,
        'INTEGRATION_IMPORT_MAKER_CHECKER_REQUIRED',
        'A different administrator must approve an imported record'
      );
    }
    try {
      if (record.job.connection.type !== 'FHIR_R4') {
        throw new DomainError(
          409,
          'DHIS2_IMPORT_REQUIRES_MANUAL_RECONCILIATION',
          'DHIS2 imports require mapping-specific reconciliation'
        );
      }
      const payload = encryption.decrypt(record);
      const command = mapFhirImport(record.job.connectionId, payload);
      const child = await withTenantTransaction(
        database,
        context.organizationId,
        (transaction) => transaction.child.findFirst({
          where: {
            organizationId: context.organizationId,
            medfinetId: command.medfinetId,
            status: 'ACTIVE',
          },
          select: { id: true },
        })
      );
      if (!child) {
        throw new DomainError(
          409,
          'FHIR_PATIENT_NOT_MATCHED',
          'FHIR resource does not match an active Medfinet child'
        );
      }
      const disclosure = await consent.evaluateDisclosure(context, child.id, {
        recipientType: 'PARTNER',
        recipientId: record.job.connection.partnerIdentifier,
        purpose: 'INTEROPERABILITY_IMPORT',
        scopes: [command.scope],
        requestId: context.requestId,
      });
      if (!disclosure.allowed) {
        throw new DomainError(
          403,
          'INTEROPERABILITY_IMPORT_CONSENT_DENIED',
          'Active write consent is required for this import'
        );
      }
      const applied = await clinical[command.method](
        context,
        child.id,
        command.input
      );
      return withTenantTransaction(database, context.organizationId, async (transaction) => {
        const updated = await transaction.integrationImportStaging.update({
          where: { id: record.id },
          data: {
            status: 'APPLIED',
            reviewedBySubjectId: context.actorSubjectId,
            reviewedAt: now(),
            reviewReason: 'APPROVED_AND_APPLIED',
            appliedResourceType: record.externalResourceType,
            appliedResourceId: applied.id,
          },
        });
        await transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'integration-import.applied',
            entityType: 'integration-import-staging',
            entityId: record.id,
            purpose: context.purpose,
            metadata: {
              appliedResourceType: record.externalResourceType,
              appliedResourceId: applied.id,
              disclosureEventId: disclosure.disclosureEventId,
            },
          },
        });
        return updated;
      });
    } catch (error) {
      if (error instanceof DomainError && error.status < 500) {
        await markConflict(context, record, error);
      }
      throw error;
    }
  }

  return { list, reveal, reject, apply };
}

module.exports = { createIntegrationImportReviewService };
