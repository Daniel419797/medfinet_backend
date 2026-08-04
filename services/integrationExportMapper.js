const { DomainError } = require('../utils/domainError');
const {
  patientResource,
  immunizationResource,
  observationResource,
  appointmentResource,
} = require('./fhirR4Adapter');
const {
  trackedEntityPayload,
  eventPayload,
  dataValueSetPayload,
} = require('./dhis2Adapter');

const RESOURCE_SCOPES = {
  Patient: [
    { category: 'IDENTITY', access: 'READ' },
    { category: 'DEMOGRAPHICS', access: 'READ' },
  ],
  Immunization: [{ category: 'IMMUNIZATION', access: 'READ' }],
  Observation: [{ category: 'NUTRITION', access: 'READ' }],
  Appointment: [{ category: 'APPOINTMENTS', access: 'READ' }],
  TRACKED_ENTITY: [
    { category: 'IDENTITY', access: 'READ' },
    { category: 'DEMOGRAPHICS', access: 'READ' },
  ],
  EVENT: [{ category: 'IMMUNIZATION', access: 'READ' }],
  DATA_VALUE_SET: [{ category: 'SERVICE_DELIVERY', access: 'READ' }],
};

function where(criteria, cursor) {
  return {
    id: {
      in: criteria.childIds,
      ...(cursor ? { gt: cursor } : {}),
    },
  };
}

async function loadExportRecords(transaction, job, batchSize) {
  const mapping = job.mapping.mappingDefinition;
  const childWhere = where(job.criteria, job.cursor);
  if (['Patient', 'TRACKED_ENTITY'].includes(job.resourceType)) {
    const children = await transaction.child.findMany({
      where: {
        organizationId: job.organizationId,
        status: 'ACTIVE',
        ...childWhere,
      },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    return children.map((child) => ({
      recordKey: `${job.resourceType}:${child.id}`,
      localResourceType: 'Child',
      localResourceId: child.id,
      childId: child.id,
      payload: job.resourceType === 'Patient'
        ? patientResource(child, mapping)
        : trackedEntityPayload(child, mapping),
      cursor: child.id,
    }));
  }
  const model = {
    Immunization: 'immunizationRecord',
    EVENT: 'immunizationRecord',
    Observation: 'growthMeasurement',
    Appointment: 'appointment',
    DATA_VALUE_SET: 'serviceDelivery',
  }[job.resourceType];
  if (!model) {
    throw new DomainError(
      500,
      'INTEGRATION_RESOURCE_UNSUPPORTED',
      'Integration export resource is unsupported'
    );
  }
  const records = await transaction[model].findMany({
    where: {
      organizationId: job.organizationId,
      childId: { in: job.criteria.childIds },
      ...(job.cursor ? { id: { gt: job.cursor } } : {}),
      ...(['Immunization', 'EVENT', 'Observation'].includes(job.resourceType)
        ? { status: { in: ['ACTIVE', 'AMENDED'] } }
        : {}),
    },
    include: { child: true },
    orderBy: { id: 'asc' },
    take: batchSize,
  });
  return records.map((record) => {
    let payload;
    if (job.resourceType === 'Immunization') {
      payload = immunizationResource(record, record.child, mapping);
    } else if (job.resourceType === 'EVENT') {
      payload = eventPayload(record, record.child, mapping);
    } else if (job.resourceType === 'Observation') {
      payload = observationResource(record, record.child, mapping);
    } else if (job.resourceType === 'Appointment') {
      payload = appointmentResource(record, record.child, mapping);
    } else {
      payload = dataValueSetPayload(record, mapping);
    }
    return {
      recordKey: `${job.resourceType}:${record.id}`,
      localResourceType: model,
      localResourceId: record.id,
      childId: record.childId,
      payload,
      cursor: record.id,
    };
  });
}

module.exports = { loadExportRecords, RESOURCE_SCOPES };
