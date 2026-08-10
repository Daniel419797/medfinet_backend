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

function isClinicalWriteRole(role) {
  return CLINICAL_WRITE_ROLES.includes(role);
}

function assertClinicalWriteAccess(context) {
  if (!isClinicalWriteRole(context?.role || context?.actorRole)) {
    throw new DomainError(
      403,
      'CLINICAL_WRITE_ACCESS_DENIED',
      'This role is not permitted to create or amend clinical records'
    );
  }
}

module.exports = {
  CLINICAL_READ_ROLES,
  CLINICAL_WRITE_ROLES,
  isClinicalWriteRole,
  assertClinicalWriteAccess,
};
