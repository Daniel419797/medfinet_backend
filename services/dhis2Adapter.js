const { DomainError } = require('../utils/domainError');

function dhisUid(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9]{10}$/.test(value)) {
    throw new DomainError(400, 'DHIS2_UID_INVALID', `${field} must be a DHIS2 UID`);
  }
  return value;
}

function trackedEntityPayload(child, mapping) {
  const attributeMap = mapping.attributeMap || {};
  const attributes = [
    ['medfinetId', child.medfinetId],
    ['firstName', child.firstName],
    ['lastName', child.lastName],
    ['dateOfBirth', child.dateOfBirth.toISOString().slice(0, 10)],
    ['sex', child.sex],
  ].filter(([field]) => attributeMap[field])
    .map(([field, value]) => ({
      attribute: dhisUid(attributeMap[field], `attributeMap.${field}`),
      value,
    }));
  return {
    trackedEntityType: dhisUid(
      mapping.trackedEntityTypeId,
      'trackedEntityTypeId'
    ),
    orgUnit: dhisUid(mapping.orgUnitId, 'orgUnitId'),
    trackedEntity: child.medfinetId,
    attributes,
  };
}

function eventPayload(record, child, mapping) {
  const dataElementMap = mapping.dataElementMap || {};
  const values = {
    vaccineCode: record.vaccineCode,
    doseNumber: record.doseNumber,
  };
  return {
    program: dhisUid(mapping.programId, 'programId'),
    orgUnit: dhisUid(mapping.orgUnitId, 'orgUnitId'),
    trackedEntity: child.medfinetId,
    occurredAt: record.administeredAt.toISOString(),
    status: 'COMPLETED',
    dataValues: Object.entries(values)
      .filter(([field]) => dataElementMap[field])
      .map(([field, value]) => ({
        dataElement: dhisUid(dataElementMap[field], `dataElementMap.${field}`),
        value: String(value),
      })),
  };
}

function dataValueSetPayload(record, mapping) {
  const dataElementMap = mapping.dataElementMap || {};
  const dataElement = dataElementMap[record.serviceType];
  if (!dataElement) {
    throw new DomainError(
      409,
      'DHIS2_DATA_ELEMENT_UNMAPPED',
      `No DHIS2 data element is mapped for ${record.serviceType}`
    );
  }
  return {
    orgUnit: dhisUid(mapping.orgUnitId, 'orgUnitId'),
    completeDate: record.deliveredAt.toISOString().slice(0, 10),
    period: record.deliveredAt.toISOString().slice(0, 10).replaceAll('-', ''),
    dataValues: [{
      dataElement: dhisUid(dataElement, `dataElementMap.${record.serviceType}`),
      value: '1',
    }],
  };
}

function validateImportSummary(payload) {
  const status = payload?.status || payload?.response?.status;
  if (!['OK', 'SUCCESS'].includes(status)) {
    throw new DomainError(
      409,
      'DHIS2_IMPORT_REJECTED',
      'DHIS2 rejected the exchange record'
    );
  }
  return payload;
}

function createDhis2Adapter(httpClient) {
  function api(connection, path) {
    return `/api/${connection.dhis2ApiVersion}${path}`;
  }

  async function health(connection) {
    const { payload } = await httpClient.request(
      connection,
      api(connection, '/system/info')
    );
    if (!payload?.version) {
      return { status: 'DEGRADED', errorCode: 'DHIS2_SYSTEM_INFO_INVALID' };
    }
    return { status: 'HEALTHY' };
  }

  async function exportResource(
    connection,
    resourceType,
    payload,
    idempotencyKey
  ) {
    const path = resourceType === 'TRACKED_ENTITY'
      ? '/tracker'
      : resourceType === 'EVENT'
        ? '/tracker'
        : '/dataValueSets';
    const body = resourceType === 'TRACKED_ENTITY'
      ? { trackedEntities: [payload] }
      : resourceType === 'EVENT'
        ? { events: [payload] }
        : payload;
    const response = await httpClient.request(
      connection,
      api(connection, path),
      {
        method: 'POST',
        body,
        headers: { 'idempotency-key': idempotencyKey },
      }
    );
    validateImportSummary(response.payload);
    const externalId = response.payload?.bundleReport?.typeReportMap
      ? Object.values(response.payload.bundleReport.typeReportMap)[0]?.objectReports?.[0]?.uid
      : null;
    return {
      externalId: externalId || payload.trackedEntity || null,
      externalVersion: null,
      payload: response.payload,
    };
  }

  async function importPage(connection, resourceType, cursor) {
    const page = cursor ? Number(cursor) : 1;
    if (!Number.isInteger(page) || page < 1) {
      throw new DomainError(409, 'DHIS2_CURSOR_INVALID', 'DHIS2 cursor is invalid');
    }
    const path = resourceType === 'TRACKED_ENTITY'
      ? `/tracker/trackedEntities?page=${page}&pageSize=100`
      : resourceType === 'EVENT'
        ? `/tracker/events?page=${page}&pageSize=100`
        : `/dataValueSets?page=${page}&pageSize=100`;
    const { payload } = await httpClient.request(connection, api(connection, path));
    const resources = payload?.instances
      || payload?.trackedEntities
      || payload?.events
      || payload?.dataValues
      || [];
    const pageCount = Number(payload?.pager?.pageCount || page);
    return {
      resources,
      nextCursor: page < pageCount ? String(page + 1) : null,
    };
  }

  async function fetchResource(connection, resourceType, externalId) {
    const path = resourceType === 'TRACKED_ENTITY'
      ? `/tracker/trackedEntities/${encodeURIComponent(externalId)}`
      : resourceType === 'EVENT'
        ? `/tracker/events/${encodeURIComponent(externalId)}`
        : null;
    if (!path) return { exists: true, externalVersion: null };
    try {
      await httpClient.request(connection, api(connection, path));
      return { exists: true, externalVersion: null };
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
  createDhis2Adapter,
  trackedEntityPayload,
  eventPayload,
  dataValueSetPayload,
  validateImportSummary,
  dhisUid,
};
