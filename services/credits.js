const { DomainError } = require('../utils/domainError');

const MAX_CREDITS = 9_000_000_000_000_000n;

function positiveCredits(value, field = 'credits') {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : value;
  if (typeof normalized !== 'string' || !/^[1-9]\d*$/.test(normalized)) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a positive integer string`
    );
  }
  const credits = BigInt(normalized);
  if (credits > MAX_CREDITS) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} exceeds the supported maximum`);
  }
  return credits;
}

module.exports = { positiveCredits, MAX_CREDITS };
