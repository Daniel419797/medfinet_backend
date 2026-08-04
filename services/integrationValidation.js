const { DomainError } = require('../utils/domainError');
const { requiredText } = require('./identityService');

const INTEGRATION_TYPES = new Set(['FHIR_R4', 'DHIS2']);
const AUTH_TYPES = new Set(['BEARER', 'BASIC', 'OAUTH2_CLIENT_CREDENTIALS']);
const DIRECTIONS = new Set(['IMPORT', 'EXPORT']);
const DATA_CATEGORIES = new Set([
  'IDENTITY',
  'DEMOGRAPHICS',
  'IMMUNIZATION',
  'NUTRITION',
  'APPOINTMENTS',
  'CLIMATE',
  'SERVICE_DELIVERY',
]);
const RESOURCE_TYPES = {
  FHIR_R4: new Set(['Patient', 'Immunization', 'Observation', 'Appointment']),
  DHIS2: new Set(['TRACKED_ENTITY', 'EVENT', 'DATA_VALUE_SET']),
};

function baseUrl(
  value,
  { allowInsecureLocalhost = false, allowedHosts = [] } = {}
) {
  const normalized = requiredText(value, 'baseUrl', 500);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new DomainError(400, 'VALIDATION_ERROR', 'baseUrl must be an absolute URL');
  }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(allowInsecureLocalhost && local)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'baseUrl must use HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'baseUrl cannot contain credentials, query parameters, or fragments'
    );
  }
  if (
    allowedHosts.length > 0
    && !allowedHosts.includes(parsed.hostname.toLowerCase())
  ) {
    throw new DomainError(
      400,
      'INTEGRATION_HOST_NOT_ALLOWED',
      'baseUrl host is not in the production integration allowlist'
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

function dataCategories(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > DATA_CATEGORIES.size) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `allowedDataCategories must contain between 1 and ${DATA_CATEGORIES.size} values`
    );
  }
  const normalized = [...new Set(values)];
  if (normalized.some((value) => !DATA_CATEGORIES.has(value))) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'A data category is unsupported');
  }
  return normalized;
}

function resourceType(type, value) {
  const normalized = requiredText(value, 'resourceType', 80);
  if (!RESOURCE_TYPES[type]?.has(normalized)) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `${normalized} is not supported for ${type}`
    );
  }
  return normalized;
}

function timeoutMs(value) {
  const normalized = value === undefined ? 10_000 : Number(value);
  if (!Number.isInteger(normalized) || normalized < 1_000 || normalized > 60_000) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'timeoutMs must be between 1000 and 60000');
  }
  return normalized;
}

module.exports = {
  INTEGRATION_TYPES,
  AUTH_TYPES,
  DIRECTIONS,
  DATA_CATEGORIES,
  RESOURCE_TYPES,
  baseUrl,
  dataCategories,
  resourceType,
  timeoutMs,
};
