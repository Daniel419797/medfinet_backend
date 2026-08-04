const { DomainError } = require('../utils/domainError');
const { requiredText } = require('./identityService');
const { VULNERABILITY_LEVELS } = require('./climateEventService');

const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function normalizeAreaCodes(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'administrativeAreaCodes must contain between 1 and 100 values'
    );
  }
  const codes = values.map((value) => requiredText(
    value,
    'administrativeAreaCode',
    80
  ).toUpperCase());
  return [...new Set(codes)];
}

function vulnerabilityRange(minimum) {
  if (!VULNERABILITY_LEVELS.has(minimum)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'minimumVulnerability is unsupported');
  }
  return LEVELS.slice(LEVELS.indexOf(minimum));
}

module.exports = { normalizeAreaCodes, vulnerabilityRange };
