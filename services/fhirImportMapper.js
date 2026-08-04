const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { validateFhirResource } = require('./fhirR4Adapter');

function patientMedfinetId(resource) {
  const reference = resource.patient?.reference
    || resource.subject?.reference
    || resource.participant?.[0]?.actor?.reference;
  if (typeof reference !== 'string' || !reference.startsWith('Patient/')) {
    throw new DomainError(
      409,
      'FHIR_PATIENT_REFERENCE_INVALID',
      'FHIR resource has no supported Patient reference'
    );
  }
  return reference.slice('Patient/'.length);
}

function sourceOperationId(connectionId, resource) {
  return `fhir:${crypto
    .createHash('sha256')
    .update(`${connectionId}:${resource.resourceType}:${resource.id}`)
    .digest('hex')
    .slice(0, 64)}`;
}

function immunizationInput(connectionId, resource) {
  validateFhirResource(resource, 'Immunization');
  const vaccineCode = resource.vaccineCode?.coding?.[0]?.code;
  const dose = resource.protocolApplied?.[0]?.doseNumberPositiveInt;
  if (typeof vaccineCode !== 'string' || !Number.isInteger(dose)) {
    throw new DomainError(
      409,
      'FHIR_IMMUNIZATION_INVALID',
      'FHIR Immunization lacks vaccine code or dose number'
    );
  }
  return {
    method: 'recordImmunization',
    medfinetId: patientMedfinetId(resource),
    scope: { category: 'IMMUNIZATION', access: 'WRITE' },
    input: {
      vaccineCode,
      doseNumber: dose,
      administeredAt: resource.occurrenceDateTime,
      sourceOperationId: sourceOperationId(connectionId, resource),
    },
  };
}

function observationInput(connectionId, resource) {
  validateFhirResource(resource, 'Observation');
  const input = {
    measuredAt: resource.effectiveDateTime,
    sourceOperationId: sourceOperationId(connectionId, resource),
  };
  for (const component of resource.component || []) {
    const code = component.code?.text;
    const value = Number(component.valueQuantity?.value);
    const unit = component.valueQuantity?.unit;
    if (!Number.isFinite(value) || value <= 0) continue;
    if (code === 'weight') {
      input.weightGrams = Math.round(unit === 'kg' ? value * 1000 : value);
    }
    if (code === 'height') {
      input.heightMillimeters = Math.round(unit === 'cm' ? value * 10 : value);
    }
    if (code === 'muac') {
      input.muacMillimeters = Math.round(unit === 'cm' ? value * 10 : value);
    }
  }
  if (
    input.weightGrams === undefined
    && input.heightMillimeters === undefined
    && input.muacMillimeters === undefined
  ) {
    throw new DomainError(
      409,
      'FHIR_OBSERVATION_INVALID',
      'FHIR Observation contains no supported growth measurement'
    );
  }
  return {
    method: 'recordGrowth',
    medfinetId: patientMedfinetId(resource),
    scope: { category: 'NUTRITION', access: 'WRITE' },
    input,
  };
}

function appointmentInput(connectionId, resource) {
  validateFhirResource(resource, 'Appointment');
  const kind = resource.serviceType?.[0]?.text;
  if (typeof kind !== 'string' || !resource.start) {
    throw new DomainError(
      409,
      'FHIR_APPOINTMENT_INVALID',
      'FHIR Appointment lacks service type or start'
    );
  }
  return {
    method: 'scheduleAppointment',
    medfinetId: patientMedfinetId(resource),
    scope: { category: 'APPOINTMENTS', access: 'WRITE' },
    input: {
      kind,
      scheduledFor: resource.start,
      sourceOperationId: sourceOperationId(connectionId, resource),
    },
  };
}

function mapFhirImport(connectionId, resource) {
  if (resource.resourceType === 'Patient') {
    throw new DomainError(
      409,
      'IDENTITY_IMPORT_REQUIRES_MANUAL_CORRECTION',
      'Patient identity imports require the identity correction workflow'
    );
  }
  if (resource.resourceType === 'Immunization') {
    return immunizationInput(connectionId, resource);
  }
  if (resource.resourceType === 'Observation') {
    return observationInput(connectionId, resource);
  }
  if (resource.resourceType === 'Appointment') {
    return appointmentInput(connectionId, resource);
  }
  throw new DomainError(
    409,
    'FHIR_IMPORT_RESOURCE_UNSUPPORTED',
    'FHIR resource cannot be applied automatically'
  );
}

module.exports = {
  mapFhirImport,
  patientMedfinetId,
  sourceOperationId,
  immunizationInput,
  observationInput,
  appointmentInput,
};
