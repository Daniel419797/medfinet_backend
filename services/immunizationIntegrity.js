const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');

const IMMUNIZATION_FINGERPRINT_VERSION = 1;
const IMMUNIZATION_FINGERPRINT_SCHEMA = 'medfinet.immunization-fingerprint';

function legacyEvidenceDigest(values) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(values), 'utf8')
    .digest('hex');
}

function canonicalValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry) => (
      entry === undefined ? null : canonicalValue(entry)
    ));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
        return result;
      }, {});
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function immunizationFingerprint(kind, evidence) {
  return crypto
    .createHash('sha256')
    .update(canonicalJson({
      evidence,
      kind,
      schema: IMMUNIZATION_FINGERPRINT_SCHEMA,
      version: IMMUNIZATION_FINGERPRINT_VERSION,
    }), 'utf8')
    .digest('hex');
}

function timestampValue(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function immunizationDeduplicationKey(childId, vaccineCode, doseNumber) {
  // This database uniqueness key predates the public fingerprint schema. Keep
  // it stable so an upgrade cannot admit duplicate active doses.
  return legacyEvidenceDigest([childId, vaccineCode, doseNumber]);
}

function immunizationEvidence(record) {
  return {
    administeredAt: timestampValue(record.administeredAt),
    administeringSubjectId: record.administeringSubjectId,
    childId: record.childId,
    doseNumber: record.doseNumber,
    facilityId: record.facilityId || null,
    id: record.id,
    lotNumber: record.lotNumber || null,
    notes: record.notes || null,
    organizationId: record.organizationId,
    programmeId: record.programmeId || null,
    route: record.route || null,
    site: record.site || null,
    vaccineCode: record.vaccineCode,
  };
}

function recordedImmunizationAnchorId(record) {
  const digest = immunizationFingerprint('recorded', immunizationEvidence(record));
  return `immunization-recorded:v${IMMUNIZATION_FINGERPRINT_VERSION}:${record.id}:${digest}`;
}

function amendedImmunizationAnchorId({
  amendmentId,
  recordId,
  previous,
  replacement,
  reason,
}) {
  const digest = immunizationFingerprint('amended', {
    amendmentId,
    previous,
    reason,
    recordId,
    replacement,
  });
  return `immunization-amended:v${IMMUNIZATION_FINGERPRINT_VERSION}:${amendmentId}:${digest}`;
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
  IMMUNIZATION_FINGERPRINT_VERSION,
  amendedImmunizationAnchorId,
  canonicalJson,
  duplicateImmunizationError,
  immunizationFingerprint,
  immunizationDeduplicationKey,
  isDeduplicationConstraintError,
  recordedImmunizationAnchorId,
  withoutImmunizationIntegrityFields,
};
