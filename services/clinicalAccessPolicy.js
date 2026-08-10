const { DomainError } = require('../utils/domainError');

const CLINICAL_READ_ROLES = Object.freeze([
  'OWNER',
  'ADMIN',
  'HEALTH_WORKER',
  'CAREGIVER',
]);

const CLINICAL_WRITE_ROLES = Object.freeze([
  'OWNER',
  'ADMIN',
  'HEALTH_WORKER',
]);

const GROWTH_WRITE_ROLES = Object.freeze([
  'OWNER',
  'ADMIN',
  'HEALTH_WORKER',
  'NUTRITION_WORKER',
]);

function roleFromContext(context) {
  return context?.role || context?.actorRole || '';
}

function isClinicalWriteRole(role) {
  return CLINICAL_WRITE_ROLES.includes(role);
}

function isGrowthWriteRole(role) {
  return GROWTH_WRITE_ROLES.includes(role);
}

function assertClinicalWriteAccess(context) {
  if (!isClinicalWriteRole(roleFromContext(context))) {
    throw new DomainError(
      403,
      'CLINICAL_WRITE_ACCESS_DENIED',
      'This role is not permitted to create or amend clinical records'
    );
  }
}

function assertGrowthWriteAccess(context) {
  if (!isGrowthWriteRole(roleFromContext(context))) {
    throw new DomainError(
      403,
      'GROWTH_WRITE_ACCESS_DENIED',
      'This role is not permitted to create or amend growth and nutrition records'
    );
  }
}

module.exports = {
  CLINICAL_READ_ROLES,
  CLINICAL_WRITE_ROLES,
  GROWTH_WRITE_ROLES,
  isClinicalWriteRole,
  isGrowthWriteRole,
  assertClinicalWriteAccess,
  assertGrowthWriteAccess,
};
