const { DomainError } = require('../utils/domainError');

const SEX_MAP = {
  FEMALE: 'female',
  MALE: 'male',
  INTERSEX: 'other',
  UNKNOWN: 'unknown',
};

function patientResource(child, mapping = {}) {
  if (!mapping.identifierSystem) {
    throw new DomainError(
      500,
      'FHIR_MAPPING_INCOMPLETE',
      'FHIR Patient identifierSystem is not configured'
    );
  }
  return {
    resourceType: 'Patient',
    id: child.medfinetId,
    ...(mapping.profileUrl ? { meta: { profile: [mapping.profileUrl] } } : {}),
    identifier: [{
      system: mapping.identifierSystem,
      value: child.medfinetId,
    }],
    active: child.status === 'ACTIVE',
    name: [{ use: 'official', family: child.lastName, given: [child.firstName] }],
    birthDate: child.dateOfBirth.toISOString().slice(0, 10),
    gender: SEX_MAP[child.sex] || 'unknown',
  };
}

function immunizationResource(record, child, mapping = {}) {
  if (!mapping.codeSystems?.vaccine) {
    throw new DomainError(
      500,
      'FHIR_MAPPING_INCOMPLETE',
      'FHIR vaccine code system is not configured'
    );
  }
  return {
    resourceType: 'Immunization',
    id: record.id,
    ...(mapping.profileUrl ? { meta: { profile: [mapping.profileUrl] } } : {}),
    status: record.status === 'ACTIVE' ? 'completed' : 'entered-in-error',
    vaccineCode: {
      coding: [{
        system: mapping.codeSystems.vaccine,
        code: record.vaccineCode,
      }],
    },
    patient: { reference: `Patient/${child.medfinetId}` },
    occurrenceDateTime: record.administeredAt.toISOString(),
    protocolApplied: [{ doseNumberPositiveInt: record.doseNumber }],
  };
}

function observationResource(record, child, mapping = {}) {
  if (!mapping.codeSystems?.observation) {
    throw new DomainError(
      500,
      'FHIR_MAPPING_INCOMPLETE',
      'FHIR observation code system is not configured'
    );
  }
  const components = [
    ['weight', record.weightGrams == null ? null : record.weightGrams / 1000, 'kg'],
    ['height', record.heightMillimeters == null ? null : record.heightMillimeters / 10, 'cm'],
    ['muac', record.muacMillimeters == null ? null : record.muacMillimeters / 10, 'cm'],
  ].filter(([, value]) => value !== null && value !== undefined);
  return {
    resourceType: 'Observation',
    id: record.id,
    ...(mapping.profileUrl ? { meta: { profile: [mapping.profileUrl] } } : {}),
    status: 'final',
    code: {
      coding: [{
        system: mapping.codeSystems.observation,
        code: 'child-growth',
      }],
    },
    subject: { reference: `Patient/${child.medfinetId}` },
    effectiveDateTime: record.measuredAt.toISOString(),
    component: components.map(([code, value, unit]) => ({
      code: { text: code },
      valueQuantity: { value: Number(value), unit },
    })),
  };
}

function appointmentResource(record, child, mapping = {}) {
  return {
    resourceType: 'Appointment',
    id: record.id,
    ...(mapping.profileUrl ? { meta: { profile: [mapping.profileUrl] } } : {}),
    status: {
      SCHEDULED: 'booked',
      COMPLETED: 'fulfilled',
      CANCELLED: 'cancelled',
      MISSED: 'noshow',
    }[record.status] || 'proposed',
    serviceType: [{ text: record.kind }],
    start: record.scheduledFor.toISOString(),
    participant: [{
      actor: { reference: `Patient/${child.medfinetId}` },
      status: 'accepted',
    }],
  };
}

function validateFhirResource(resource, expectedType) {
  if (
    !resource
    || resource.resourceType !== expectedType
    || (resource.id !== undefined && typeof resource.id !== 'string')
  ) {
    throw new DomainError(
      409,
      'FHIR_RESOURCE_INVALID',
      `Partner returned an invalid ${expectedType} resource`
    );
  }
  return resource;
}

function createFhirR4Adapter(httpClient) {
  async function health(connection) {
    const { payload } = await httpClient.request(connection, '/metadata');
    validateFhirResource(payload, 'CapabilityStatement');
    if (!String(payload.fhirVersion || '').startsWith('4.0')) {
      return { status: 'DEGRADED', errorCode: 'FHIR_VERSION_MISMATCH' };
    }
    return { status: 'HEALTHY' };
  }

  async function exportResource(connection, resource) {
    validateFhirResource(resource, resource.resourceType);
    const { payload } = await httpClient.request(
      connection,
      `/${resource.resourceType}/${encodeURIComponent(resource.id)}`,
      { method: 'PUT', body: resource }
    );
    const result = validateFhirResource(payload, resource.resourceType);
    return {
      externalId: result.id || resource.id,
      externalVersion: result.meta?.versionId || null,
      payload: result,
    };
  }

  async function importPage(connection, resourceType, cursor) {
    const path = cursor
      ? `/${resourceType}?_page_token=${encodeURIComponent(cursor)}`
      : `/${resourceType}?_count=100`;
    const { payload } = await httpClient.request(connection, path);
    validateFhirResource(payload, 'Bundle');
    const nextLink = payload.link?.find(({ relation }) => relation === 'next')?.url;
    let nextCursor = null;
    if (nextLink) {
      const nextUrl = new URL(nextLink, `${connection.baseUrl}/`);
      if (nextUrl.origin !== new URL(connection.baseUrl).origin) {
        throw new DomainError(
          409,
          'FHIR_PAGINATION_LINK_INVALID',
          'FHIR next link points outside the configured partner'
        );
      }
      nextCursor = nextUrl.searchParams.get('_page_token')
        || nextUrl.searchParams.get('_getpages')
        || null;
    }
    return {
      resources: (payload.entry || []).map(({ resource }) => (
        validateFhirResource(resource, resourceType)
      )),
      nextCursor,
    };
  }

  async function fetchResource(connection, resourceType, externalId) {
    try {
      const { payload } = await httpClient.request(
        connection,
        `/${resourceType}/${encodeURIComponent(externalId)}`
      );
      const resource = validateFhirResource(payload, resourceType);
      return {
        exists: true,
        externalVersion: resource.meta?.versionId || null,
      };
    } catch (error) {
      if (
        error instanceof DomainError
        && error.code === 'INTEGRATION_PARTNER_REJECTED'
        && error.details?.partnerStatus === 404
      ) {
        return { exists: false, externalVersion: null };
      }
      throw error;
    }
  }

  return { health, exportResource, importPage, fetchResource };
}

module.exports = {
  createFhirR4Adapter,
  patientResource,
  immunizationResource,
  observationResource,
  appointmentResource,
  validateFhirResource,
  SEX_MAP,
};
