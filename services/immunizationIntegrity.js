const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');

const LEGACY_IMMUNIZATION_FINGERPRINT_VERSION = 1;
const IMMUNIZATION_FINGERPRINT_VERSION = 2;
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

function immunizationFingerprint(kind, evidence, version = IMMUNIZATION_FINGERPRINT_VERSION) {
  return crypto
    .createHash('sha256')
    .update(canonicalJson({
      evidence,
      kind,
      schema: IMMUNIZATION_FINGERPRINT_SCHEMA,
      version,
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

function certificateMetadataEvidence(metadata) {
  if (!metadata) return null;
  return {
    facilityId: metadata.facilityId || null,
    facilityName: metadata.facilityName || null,
    lga: metadata.lga || null,
    recordedBySubjectId: metadata.recordedBySubjectId || null,
    state: metadata.state || null,
    vaccinatorName: metadata.vaccinatorName || null,
    vaccinatorSubjectId: metadata.vaccinatorSubjectId || null,
    ward: metadata.ward || null,
  };
}

function immunizationEvidence(record, version = null) {
  const activeVersion = version || (
    record.certificateMetadata
      ? IMMUNIZATION_FINGERPRINT_VERSION
      : LEGACY_IMMUNIZATION_FINGERPRINT_VERSION
  );
  const evidence = {
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
  if (activeVersion >= 2) {
    evidence.certificateMetadata = certificateMetadataEvidence(
      record.certificateMetadata
    );
  }
  return evidence;
}

function recordedImmunizationAnchorId(record) {
  // Historical records that predate certificate snapshots must retain their
  // exact v1 proof IDs. New records with certificate metadata use v2.
  const version = record.certificateMetadata
    ? IMMUNIZATION_FINGERPRINT_VERSION
    : LEGACY_IMMUNIZATION_FINGERPRINT_VERSION;
  const digest = immunizationFingerprint(
    'recorded',
    immunizationEvidence(record, version),
    version
  );
  return `immunization-recorded:v${version}:${record.id}:${digest}`;
}

function amendedImmunizationAnchorId({
  amendmentId,
  recordId,
  previous,
  replacement,
  reason,
}) {
  const carriesCertificateMetadata = Boolean(
    previous
      && Object.prototype.hasOwnProperty.call(previous, 'certificateMetadata')
  ) || Boolean(
    replacement
      && Object.prototype.hasOwnProperty.call(replacement, 'certificateMetadata')
  );
  const version = carriesCertificateMetadata
    ? IMMUNIZATION_FINGERPRINT_VERSION
    : LEGACY_IMMUNIZATION_FINGERPRINT_VERSION;
  const digest = immunizationFingerprint('amended', {
    amendmentId,
    previous,
    reason,
    recordId,
    replacement,
  }, version);
  return `immunization-amended:v${version}:${amendmentId}:${digest}`;
}

function fingerprintVersionFromAnchorId(anchorId) {
  const match = String(anchorId || '').match(/:v(\d+):/);
  const version = Number(match?.[1]);
  return Number.isInteger(version) && version > 0
    ? version
    : LEGACY_IMMUNIZATION_FINGERPRINT_VERSION;
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
  LEGACY_IMMUNIZATION_FINGERPRINT_VERSION,
  amendedImmunizationAnchorId,
  canonicalJson,
  duplicateImmunizationError,
  fingerprintVersionFromAnchorId,
  immunizationFingerprint,
  immunizationDeduplicationKey,
  isDeduplicationConstraintError,
  recordedImmunizationAnchorId,
  withoutImmunizationIntegrityFields,
};
