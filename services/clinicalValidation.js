const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');

const CREDENTIAL_KINDS = new Set(['QR', 'NFC', 'RECOVERY']);
const ALERT_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const APPOINTMENT_STATUSES = new Set([
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
  'MISSED',
]);
const APPOINTMENT_TRANSITIONS = {
  SCHEDULED: new Set(['COMPLETED', 'CANCELLED', 'MISSED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
  MISSED: new Set(),
};

function boundedInteger(
  value,
  field,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {}
) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `${field} must be an integer between ${min} and ${max}`
    );
  }
  return value;
}

function timestamp(value, field, { future = true } = {}) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.valueOf())) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a valid timestamp`
    );
  }
  if (!future && parsed > new Date()) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `${field} cannot be in the future`
    );
  }
  return parsed;
}

function tokenDigest(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function withoutTokenHash(credential) {
  const { tokenHash, ...safeCredential } = credential;
  return safeCredential;
}

function audit(context, action, entityType, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: context.actorSubjectId,
    action,
    entityType,
    entityId,
    purpose: context.purpose,
    ...(metadata ? { metadata } : {}),
  };
}

module.exports = {
  CREDENTIAL_KINDS,
  ALERT_SEVERITIES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  boundedInteger,
  timestamp,
  tokenDigest,
  withoutTokenHash,
  audit,
};
