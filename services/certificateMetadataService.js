const { DomainError } = require('../utils/domainError');
const { requiredText } = require('./identityService');

const LOCATION_FIELDS = Object.freeze(['facilityName', 'state', 'lga', 'ward']);
const SNAPSHOT_INPUT_FIELDS = Object.freeze([
  'facilityId',
  'facilityName',
  'state',
  'lga',
  'ward',
  'vaccinatorMode',
  'vaccinatorName',
]);

function optionalText(value, field, maximum = 160) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return requiredText(value, field, maximum);
}

function snapshotTouched(input = {}) {
  return SNAPSHOT_INPUT_FIELDS.some((field) => input[field] !== undefined);
}

function actorDisplayName(context, suppliedName) {
  const name = String(context?.actorDisplayName || suppliedName || '').trim();
  if (!name) {
    throw new DomainError(
      400,
      'VACCINATOR_NAME_REQUIRED',
      'The authenticated account has no display name. Provide the vaccinator name before recording this vaccination'
    );
  }
  return requiredText(name, 'vaccinatorName', 160);
}

function completeLocation(values) {
  const normalized = {};
  for (const field of LOCATION_FIELDS) {
    normalized[field] = requiredText(values[field], field, 160);
  }
  return normalized;
}

function supportsCertificateStore(transaction) {
  return typeof transaction?.$queryRawUnsafe === 'function';
}

async function readFacilityProfile(transaction, context, facilityId) {
  if (!facilityId || !supportsCertificateStore(transaction)) return null;
  const rows = await transaction.$queryRawUnsafe(
    `SELECT
       facility_id AS "facilityId",
       organization_id AS "organizationId",
       state,
       lga,
       ward,
       updated_by_subject_id AS "updatedBySubjectId",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM medfinet_certificate.facility_profiles
     WHERE organization_id = $1 AND facility_id = $2
     LIMIT 1`,
    context.organizationId,
    facilityId
  );
  return rows[0] || null;
}

async function saveFacilityProfile(transaction, context, facilityId, input = {}) {
  const existing = await readFacilityProfile(transaction, context, facilityId);
  const state = input.state === undefined
    ? existing?.state || null
    : optionalText(input.state, 'state');
  const lga = input.lga === undefined
    ? existing?.lga || null
    : optionalText(input.lga, 'lga');
  const ward = input.ward === undefined
    ? existing?.ward || null
    : optionalText(input.ward, 'ward');
  if (!supportsCertificateStore(transaction)) {
    return {
      facilityId,
      organizationId: context.organizationId,
      state,
      lga,
      ward,
      updatedBySubjectId: context.actorSubjectId,
    };
  }

  const rows = await transaction.$queryRawUnsafe(
    `INSERT INTO medfinet_certificate.facility_profiles (
       facility_id,
       organization_id,
       state,
       lga,
       ward,
       updated_by_subject_id
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (facility_id) DO UPDATE SET
       state = EXCLUDED.state,
       lga = EXCLUDED.lga,
       ward = EXCLUDED.ward,
       updated_by_subject_id = EXCLUDED.updated_by_subject_id,
       updated_at = NOW()
     WHERE medfinet_certificate.facility_profiles.organization_id = EXCLUDED.organization_id
     RETURNING
       facility_id AS "facilityId",
       organization_id AS "organizationId",
       state,
       lga,
       ward,
       updated_by_subject_id AS "updatedBySubjectId",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    facilityId,
    context.organizationId,
    state,
    lga,
    ward,
    context.actorSubjectId
  );
  return rows[0];
}

function mergeFacilityProfile(facility, profile) {
  return {
    ...facility,
    state: profile?.state || facility.administrativeArea || null,
    lga: profile?.lga || null,
    ward: profile?.ward || null,
  };
}

async function enrichFacilities(transaction, context, facilities) {
  if (!facilities.length) return facilities;
  if (!supportsCertificateStore(transaction)) {
    return facilities.map((facility) => mergeFacilityProfile(facility, null));
  }
  const ids = facilities.map((facility) => facility.id);
  const rows = await transaction.$queryRawUnsafe(
    `SELECT
       facility_id AS "facilityId",
       state,
       lga,
       ward
     FROM medfinet_certificate.facility_profiles
     WHERE organization_id = $1 AND facility_id = ANY($2::text[])`,
    context.organizationId,
    ids
  );
  const profiles = new Map(rows.map((row) => [row.facilityId, row]));
  return facilities.map((facility) => mergeFacilityProfile(
    facility,
    profiles.get(facility.id) || null
  ));
}

async function readImmunizationSnapshot(transaction, context, immunizationId) {
  if (!supportsCertificateStore(transaction)) return null;
  const rows = await transaction.$queryRawUnsafe(
    `SELECT
       immunization_id AS "immunizationId",
       organization_id AS "organizationId",
       facility_id AS "facilityId",
       facility_name AS "facilityName",
       state,
       lga,
       ward,
       vaccinator_name AS "vaccinatorName",
       vaccinator_subject_id AS "vaccinatorSubjectId",
       recorded_by_subject_id AS "recordedBySubjectId",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM medfinet_certificate.immunization_snapshots
     WHERE organization_id = $1 AND immunization_id = $2
     LIMIT 1`,
    context.organizationId,
    immunizationId
  );
  return rows[0] || null;
}

async function readImmunizationSnapshots(transaction, context, immunizationIds) {
  if (!immunizationIds.length || !supportsCertificateStore(transaction)) {
    return new Map();
  }
  const rows = await transaction.$queryRawUnsafe(
    `SELECT
       immunization_id AS "immunizationId",
       organization_id AS "organizationId",
       facility_id AS "facilityId",
       facility_name AS "facilityName",
       state,
       lga,
       ward,
       vaccinator_name AS "vaccinatorName",
       vaccinator_subject_id AS "vaccinatorSubjectId",
       recorded_by_subject_id AS "recordedBySubjectId"
     FROM medfinet_certificate.immunization_snapshots
     WHERE organization_id = $1 AND immunization_id = ANY($2::text[])`,
    context.organizationId,
    immunizationIds
  );
  return new Map(rows.map((row) => [row.immunizationId, row]));
}

async function saveImmunizationSnapshot(
  transaction,
  context,
  immunizationId,
  snapshot
) {
  if (!supportsCertificateStore(transaction)) {
    return {
      immunizationId,
      organizationId: context.organizationId,
      ...snapshot,
    };
  }
  const rows = await transaction.$queryRawUnsafe(
    `INSERT INTO medfinet_certificate.immunization_snapshots (
       immunization_id,
       organization_id,
       facility_id,
       facility_name,
       state,
       lga,
       ward,
       vaccinator_name,
       vaccinator_subject_id,
       recorded_by_subject_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (immunization_id) DO UPDATE SET
       facility_id = EXCLUDED.facility_id,
       facility_name = EXCLUDED.facility_name,
       state = EXCLUDED.state,
       lga = EXCLUDED.lga,
       ward = EXCLUDED.ward,
       vaccinator_name = EXCLUDED.vaccinator_name,
       vaccinator_subject_id = EXCLUDED.vaccinator_subject_id,
       recorded_by_subject_id = medfinet_certificate.immunization_snapshots.recorded_by_subject_id,
       updated_at = NOW()
     WHERE medfinet_certificate.immunization_snapshots.organization_id = EXCLUDED.organization_id
     RETURNING
       immunization_id AS "immunizationId",
       organization_id AS "organizationId",
       facility_id AS "facilityId",
       facility_name AS "facilityName",
       state,
       lga,
       ward,
       vaccinator_name AS "vaccinatorName",
       vaccinator_subject_id AS "vaccinatorSubjectId",
       recorded_by_subject_id AS "recordedBySubjectId",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    immunizationId,
    context.organizationId,
    snapshot.facilityId || null,
    snapshot.facilityName,
    snapshot.state,
    snapshot.lga,
    snapshot.ward,
    snapshot.vaccinatorName,
    snapshot.vaccinatorSubjectId || null,
    snapshot.recordedBySubjectId
  );
  return rows[0];
}

async function facilityLocation(transaction, context, facilityId) {
  if (!facilityId) return null;
  const facility = await transaction.facility.findFirst({
    where: { id: facilityId, organizationId: context.organizationId },
    select: {
      id: true,
      name: true,
      administrativeArea: true,
      isActive: true,
    },
  });
  if (!facility) {
    throw new DomainError(404, 'FACILITY_NOT_FOUND', 'Facility not found');
  }
  const profile = await readFacilityProfile(transaction, context, facility.id);
  return {
    facility,
    profile,
    values: {
      facilityName: facility.name,
      state: profile?.state || facility.administrativeArea || null,
      lga: profile?.lga || null,
      ward: profile?.ward || null,
    },
  };
}

function resolveVaccinator(context, input = {}, existing = null, { initial = false } = {}) {
  const modeProvided = input.vaccinatorMode !== undefined;
  const nameProvided = input.vaccinatorName !== undefined;
  if (!initial && !modeProvided && !nameProvided && existing?.vaccinatorName) {
    return {
      vaccinatorName: existing.vaccinatorName,
      vaccinatorSubjectId: existing.vaccinatorSubjectId || null,
    };
  }

  const mode = input.vaccinatorMode || (nameProvided ? 'OTHER' : 'SELF');
  if (!['SELF', 'OTHER'].includes(mode)) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'vaccinatorMode must be SELF or OTHER'
    );
  }
  if (mode === 'SELF') {
    return {
      // Offline sync has no Supabase user object in the worker. It may supply
      // the authenticated worker's cached display name while the backend still
      // binds the snapshot to the authenticated actor subject ID.
      vaccinatorName: actorDisplayName(context, input.vaccinatorName),
      vaccinatorSubjectId: context.actorSubjectId,
    };
  }
  return {
    vaccinatorName: requiredText(input.vaccinatorName, 'vaccinatorName', 160),
    vaccinatorSubjectId: null,
  };
}

async function buildInitialImmunizationSnapshot(transaction, context, input = {}) {
  const facilityId = input.facilityId ? requiredText(input.facilityId, 'facilityId', 160) : null;
  const location = await facilityLocation(transaction, context, facilityId);
  const values = {
    facilityName: input.facilityName || location?.values.facilityName,
    state: input.state || location?.values.state,
    lga: input.lga || location?.values.lga,
    ward: input.ward || location?.values.ward,
  };
  const normalizedLocation = completeLocation(values);
  const vaccinator = resolveVaccinator(context, input, null, { initial: true });
  return {
    facilityId,
    ...normalizedLocation,
    ...vaccinator,
    recordedBySubjectId: context.actorSubjectId,
  };
}

async function buildAmendedImmunizationSnapshot(
  transaction,
  context,
  existingRecord,
  input = {},
  existingSnapshot = null
) {
  if (!snapshotTouched(input)) return existingSnapshot;

  const facilityId = input.facilityId === undefined
    ? (existingSnapshot?.facilityId || existingRecord.facilityId || null)
    : (input.facilityId ? requiredText(input.facilityId, 'facilityId', 160) : null);
  const facilityChanged = input.facilityId !== undefined
    && facilityId !== (existingSnapshot?.facilityId || existingRecord.facilityId || null);
  const location = await facilityLocation(transaction, context, facilityId);

  // Do not reconstruct historical certificate facts from a facility's current
  // profile. A legacy record without a snapshot must explicitly supply State,
  // LGA, Ward and vaccinator details from source evidence.
  const base = existingSnapshot
    ? (facilityChanged
      ? location?.values || {}
      : {
        facilityName: existingSnapshot.facilityName || location?.values.facilityName,
        state: existingSnapshot.state || location?.values.state,
        lga: existingSnapshot.lga || location?.values.lga,
        ward: existingSnapshot.ward || location?.values.ward,
      })
    : {
      facilityName: location?.values.facilityName || null,
      state: null,
      lga: null,
      ward: null,
    };
  const normalizedLocation = completeLocation({
    facilityName: input.facilityName === undefined ? base.facilityName : input.facilityName,
    state: input.state === undefined ? base.state : input.state,
    lga: input.lga === undefined ? base.lga : input.lga,
    ward: input.ward === undefined ? base.ward : input.ward,
  });
  const vaccinator = resolveVaccinator(context, input, existingSnapshot, { initial: false });

  if (!vaccinator.vaccinatorName) {
    throw new DomainError(
      400,
      'VACCINATOR_NAME_REQUIRED',
      'Record the actual vaccinator before updating certificate details'
    );
  }

  return {
    facilityId,
    ...normalizedLocation,
    ...vaccinator,
    recordedBySubjectId:
      existingSnapshot?.recordedBySubjectId
      || existingRecord.administeringSubjectId
      || context.actorSubjectId,
  };
}

function snapshotForEvidence(snapshot) {
  if (!snapshot) return null;
  return {
    facilityId: snapshot.facilityId || null,
    facilityName: snapshot.facilityName,
    state: snapshot.state,
    lga: snapshot.lga,
    ward: snapshot.ward,
    vaccinatorName: snapshot.vaccinatorName,
    vaccinatorSubjectId: snapshot.vaccinatorSubjectId || null,
    recordedBySubjectId: snapshot.recordedBySubjectId,
  };
}

module.exports = {
  buildAmendedImmunizationSnapshot,
  buildInitialImmunizationSnapshot,
  enrichFacilities,
  mergeFacilityProfile,
  readFacilityProfile,
  readImmunizationSnapshot,
  readImmunizationSnapshots,
  saveFacilityProfile,
  saveImmunizationSnapshot,
  snapshotForEvidence,
  snapshotTouched,
};
