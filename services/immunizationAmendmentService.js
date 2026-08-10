const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { boundedInteger, timestamp, audit } = require('./clinicalValidation');
const { EVENT_TYPES } = require('./blockchain/eventTypes');
const { assertClinicalWriteAccess } = require('./clinicalAccessPolicy');
const { assertResourceScope } = require('./resourceScopeService');
const {
  buildAmendedImmunizationSnapshot,
  readImmunizationSnapshot,
  saveImmunizationSnapshot,
  snapshotForEvidence,
  snapshotTouched,
} = require('./certificateMetadataService');
const {
  IMMUNIZATION_FINGERPRINT_VERSION,
  amendedImmunizationAnchorId,
  duplicateImmunizationError,
  immunizationDeduplicationKey,
  isDeduplicationConstraintError,
  withoutImmunizationIntegrityFields,
} = require('./immunizationIntegrity');

function jsonEvidence(value) {
  return JSON.parse(JSON.stringify(value));
}

function optionalText(value, field, maximum) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maximum);
}

function createImmunizationAmendmentService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function amend(context, recordId, input = {}) {
    assertClinicalWriteAccess(context);
    const reason = requiredText(input.reason, 'reason', 1000);

    try {
      return await withTenantTransaction(database, context.organizationId, async (transaction) => {
        const existing = await transaction.immunizationRecord.findFirst({
          where: {
            id: recordId,
            organizationId: context.organizationId,
            status: { in: ['ACTIVE', 'AMENDED'] },
          },
        });
        if (!existing) {
          throw new DomainError(
            404,
            'IMMUNIZATION_NOT_AMENDABLE',
            'Active immunization record not found'
          );
        }

        const existingSnapshot = await readImmunizationSnapshot(
          transaction,
          context,
          existing.id
        );
        const requestedFacilityId = input.facilityId === undefined
          ? existing.facilityId
          : (input.facilityId || null);
        if (input.facilityId !== undefined) {
          await assertResourceScope(transaction, context, {
            facilityId: requestedFacilityId || undefined,
            programmeId: existing.programmeId || undefined,
          });
        }

        const replacement = {
          vaccineCode: input.vaccineCode === undefined
            ? existing.vaccineCode
            : requiredText(input.vaccineCode, 'vaccineCode', 60).toUpperCase(),
          doseNumber: input.doseNumber === undefined
            ? existing.doseNumber
            : boundedInteger(input.doseNumber, 'doseNumber', { max: 20 }),
          administeredAt: input.administeredAt === undefined
            ? existing.administeredAt
            : timestamp(input.administeredAt, 'administeredAt', { future: false }),
          facilityId: requestedFacilityId,
          lotNumber: input.lotNumber === undefined
            ? existing.lotNumber
            : optionalText(input.lotNumber, 'lotNumber', 100),
          route: input.route === undefined
            ? existing.route
            : optionalText(input.route, 'route', 80),
          site: input.site === undefined
            ? existing.site
            : optionalText(input.site, 'site', 80),
          notes: input.notes === undefined
            ? existing.notes
            : optionalText(input.notes, 'notes', 1000),
        };

        const identityChanged = replacement.vaccineCode !== existing.vaccineCode
          || replacement.doseNumber !== existing.doseNumber;
        if (identityChanged) {
          const duplicate = await transaction.immunizationRecord.findFirst({
            where: {
              id: { not: existing.id },
              organizationId: context.organizationId,
              childId: existing.childId,
              vaccineCode: replacement.vaccineCode,
              doseNumber: replacement.doseNumber,
              status: { in: ['ACTIVE', 'AMENDED'] },
            },
            select: { id: true },
          });
          if (duplicate) throw duplicateImmunizationError(duplicate.id);
        }

        const metadataWasTouched = snapshotTouched(input);
        const replacementSnapshot = await buildAmendedImmunizationSnapshot(
          transaction,
          context,
          existing,
          input,
          existingSnapshot
        );

        const record = await transaction.immunizationRecord.update({
          where: { id: existing.id },
          data: {
            vaccineCode: replacement.vaccineCode,
            doseNumber: replacement.doseNumber,
            administeredAt: replacement.administeredAt,
            facilityId: replacement.facilityId,
            lotNumber: replacement.lotNumber,
            route: replacement.route,
            site: replacement.site,
            notes: replacement.notes,
            deduplicationKey: immunizationDeduplicationKey(
              existing.childId,
              replacement.vaccineCode,
              replacement.doseNumber
            ),
            status: 'AMENDED',
          },
        });

        let savedSnapshot = existingSnapshot;
        if (metadataWasTouched && replacementSnapshot) {
          savedSnapshot = await saveImmunizationSnapshot(
            transaction,
            context,
            existing.id,
            replacementSnapshot
          );
        }

        const previousCertificateMetadata = snapshotForEvidence(existingSnapshot);
        const replacementCertificateMetadata = snapshotForEvidence(savedSnapshot);
        const previousData = jsonEvidence({
          vaccineCode: existing.vaccineCode,
          doseNumber: existing.doseNumber,
          administeredAt: existing.administeredAt,
          lotNumber: existing.lotNumber,
          route: existing.route,
          site: existing.site,
          notes: existing.notes,
          ...(previousCertificateMetadata
            ? {
              facilityId: existing.facilityId || null,
              certificateMetadata: previousCertificateMetadata,
            }
            : {}),
        });
        const replacementData = jsonEvidence({
          vaccineCode: replacement.vaccineCode,
          doseNumber: replacement.doseNumber,
          administeredAt: replacement.administeredAt,
          lotNumber: replacement.lotNumber,
          route: replacement.route,
          site: replacement.site,
          notes: replacement.notes,
          ...(replacementCertificateMetadata
            ? {
              facilityId: replacement.facilityId || null,
              certificateMetadata: replacementCertificateMetadata,
            }
            : {}),
        });

        const amendment = await transaction.clinicalAmendment.create({
          data: {
            organizationId: context.organizationId,
            immunizationId: existing.id,
            reason,
            previousData,
            replacementData,
            amendedBySubjectId: context.actorSubjectId,
          },
        });
        const anchor = EVENT_TYPES.IMMUNIZATION_AMEND;
        const anchorId = amendedImmunizationAnchorId({
          amendmentId: amendment.id,
          recordId: existing.id,
          previous: previousData,
          replacement: replacementData,
          reason,
        });
        const versionMatch = anchorId.match(/:v(\d+):/);
        const fingerprintVersion = Number(versionMatch?.[1])
          || IMMUNIZATION_FINGERPRINT_VERSION;

        await Promise.all([
          transaction.auditEvent.create({
            data: audit(
              context,
              'immunization.amended',
              'immunization',
              existing.id,
              {
                reason,
                certificateMetadataChanged: metadataWasTouched,
                facilityId: replacement.facilityId || null,
              }
            ),
          }),
          transaction.outboxEvent.create({
            data: {
              organizationId: context.organizationId,
              eventType: 'BLOCKCHAIN_ANCHOR_REQUESTED',
              aggregateType: 'blockchain-anchor',
              aggregateId: amendment.id,
              idempotencyKey: `blockchain:${anchor.code}:v${fingerprintVersion}:${amendment.id}`,
              payload: {
                eventCode: anchor.code,
                anchorId,
                tenantId: context.organizationId,
              },
            },
          }),
        ]);

        return {
          ...withoutImmunizationIntegrityFields(record),
          certificateMetadata: replacementCertificateMetadata,
        };
      });
    } catch (error) {
      if (isDeduplicationConstraintError(error)) {
        throw duplicateImmunizationError();
      }
      throw error;
    }
  }

  return { amend };
}

module.exports = { createImmunizationAmendmentService };
