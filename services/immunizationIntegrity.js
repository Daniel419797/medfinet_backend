const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');

function evidenceDigest(values) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(values), 'utf8')
    .digest('hex');
}

function timestampValue(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function immunizationDeduplicationKey(childId, vaccineCode, doseNumber) {
  return evidenceDigest([childId, vaccineCode, doseNumber]);
}

function immunizationEvidence(record) {
  return [
    record.organizationId,
    record.id,
    record.childId,
    record.facilityId || null,
    record.programmeId || null,
    record.vaccineCode,
    record.doseNumber,
    timestampValue(record.administeredAt),
    record.lotNumber || null,
    record.route || null,
    record.site || null,
    record.notes || null,
    record.administeringSubjectId,
  ];
}

function recordedImmunizationAnchorId(record) {
  return `immunization-recorded:${record.id}:${evidenceDigest(immunizationEvidence(record))}`;
}

function amendedImmunizationAnchorId({
  amendmentId,
  recordId,
  previous,
  replacement,
  reason,
}) {
  const digest = evidenceDigest([
    recordId,
    previous,
    replacement,
    reason,
  ]);
  return `immunization-amended:${amendmentId}:${digest}`;
}

function duplicateImmunizationError(existingRecordId) {
  return new DomainError(
    409,
    'IMMUNIZATION_ALREADY_RECORDED',
    'This vaccine dose is already recorded for the child',
    existingRecordId ? { existingRecordId } : undefined
  );
}

function isDeduplicationConstraintError(error) {
  if (error?.code !== 'P2002') return false;
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes('deduplicationKey')
    : String(target || '').includes('deduplicationKey');
}

function withoutImmunizationIntegrityFields(record) {
  const { deduplicationKey, ...publicRecord } = record;
  return publicRecord;
}

module.exports = {
  amendedImmunizationAnchorId,
  duplicateImmunizationError,
  immunizationDeduplicationKey,
  isDeduplicationConstraintError,
  recordedImmunizationAnchorId,
  withoutImmunizationIntegrityFields,
};
