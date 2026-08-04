const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const {
  DIRECTIONS,
  resourceType,
} = require('./integrationValidation');

const FORBIDDEN_MAPPING_KEYS = new Set([
  'script',
  'expression',
  'eval',
  'template',
  'callbackUrl',
]);

function validateObject(value, field) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} must be an object`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 20_000) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} exceeds 20,000 characters`);
  }
  const inspect = (item) => {
    if (Array.isArray(item)) {
      item.forEach(inspect);
      return;
    }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (FORBIDDEN_MAPPING_KEYS.has(key)) {
        throw new DomainError(
          400,
          'UNSAFE_INTEGRATION_MAPPING',
          `${key} is not allowed in mapping definitions`
        );
      }
      inspect(child);
    }
  };
  inspect(value);
  return value;
}

function namespaceUri(value, field) {
  try {
    const parsed = new URL(value);
    if (!['https:', 'urn:'].includes(parsed.protocol)) throw new Error('unsafe protocol');
    return parsed.toString();
  } catch {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `${field} must be an HTTPS or URN namespace`
    );
  }
}

function mappingDefinition(type, resource, value) {
  const definition = validateObject(value, 'mappingDefinition');
  if (type === 'FHIR_R4') {
    const allowedKeys = new Set(['profileUrl', 'codeSystems', 'identifierSystem']);
    if (Object.keys(definition).some((key) => !allowedKeys.has(key))) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'FHIR mapping definition contains an unsupported key'
      );
    }
    if (definition.profileUrl) {
      definition.profileUrl = namespaceUri(definition.profileUrl, 'profileUrl');
    }
    if (resource === 'Patient' && !definition.identifierSystem) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'identifierSystem is required for Patient mappings'
      );
    }
    if (definition.identifierSystem) {
      definition.identifierSystem = namespaceUri(
        definition.identifierSystem,
        'identifierSystem'
      );
    }
    if (
      resource === 'Immunization'
      && !definition.codeSystems?.vaccine
    ) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'codeSystems.vaccine is required for Immunization mappings'
      );
    }
    if (definition.codeSystems) {
      definition.codeSystems = Object.fromEntries(
        Object.entries(definition.codeSystems).map(([name, value]) => [
          name,
          namespaceUri(value, `codeSystems.${name}`),
        ])
      );
    }
    if (
      resource === 'Observation'
      && !definition.codeSystems?.observation
    ) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'codeSystems.observation is required for Observation mappings'
      );
    }
  }
  if (type === 'DHIS2') {
    const allowedKeys = new Set([
      'programId',
      'trackedEntityTypeId',
      'orgUnitId',
      'attributeMap',
      'dataElementMap',
    ]);
    if (Object.keys(definition).some((key) => !allowedKeys.has(key))) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'DHIS2 mapping definition contains an unsupported key'
      );
    }
    const requiredKey = resource === 'TRACKED_ENTITY'
      ? 'trackedEntityTypeId'
      : resource === 'EVENT'
        ? 'programId'
        : 'dataElementMap';
    if (!definition[requiredKey]) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        `${requiredKey} is required for ${resource}`
      );
    }
  }
  return definition;
}

function createIntegrationMappingService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function createMapping(context, connectionId, input) {
    if (!DIRECTIONS.has(input.direction)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'direction is unsupported');
    }
    const version = Number(input.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'version must be a positive integer');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const connection = await transaction.integrationConnection.findFirst({
        where: {
          id: connectionId,
          organizationId: context.organizationId,
          status: { not: 'CLOSED' },
        },
      });
      if (!connection) {
        throw new DomainError(404, 'INTEGRATION_CONNECTION_NOT_FOUND', 'Connection not found');
      }
      const normalizedResource = resourceType(connection.type, input.resourceType);
      const mapping = await transaction.integrationMapping.create({
        data: {
          organizationId: context.organizationId,
          connectionId,
          resourceType: normalizedResource,
          direction: input.direction,
          version,
          mappingDefinition: mappingDefinition(
            connection.type,
            normalizedResource,
            input.mappingDefinition
          ),
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'integration-mapping.created',
          entityType: 'integration-mapping',
          entityId: mapping.id,
          purpose: context.purpose,
          metadata: {
            connectionId,
            resourceType: normalizedResource,
            direction: input.direction,
            version,
          },
        },
      });
      return mapping;
    });
  }

  async function activateMapping(context, mappingId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.integrationMapping.findFirst({
        where: {
          id: mappingId,
          organizationId: context.organizationId,
          status: 'DRAFT',
          connection: { status: { in: ['DRAFT', 'ACTIVE'] } },
        },
      });
      if (!existing) {
        throw new DomainError(404, 'DRAFT_INTEGRATION_MAPPING_NOT_FOUND', 'Draft mapping not found');
      }
      const activatedAt = now();
      await transaction.integrationMapping.updateMany({
        where: {
          organizationId: context.organizationId,
          connectionId: existing.connectionId,
          resourceType: existing.resourceType,
          direction: existing.direction,
          status: 'ACTIVE',
        },
        data: { status: 'RETIRED', retiredAt: activatedAt },
      });
      const mapping = await transaction.integrationMapping.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          activatedBySubjectId: context.actorSubjectId,
          activatedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'integration-mapping.activated',
          entityType: 'integration-mapping',
          entityId: mapping.id,
          purpose: context.purpose,
        },
      });
      return mapping;
    });
  }

  return { createMapping, activateMapping };
}

module.exports = {
  createIntegrationMappingService,
  mappingDefinition,
  validateObject,
  FORBIDDEN_MAPPING_KEYS,
  namespaceUri,
};
