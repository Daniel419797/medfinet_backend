const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const {
  INTEGRATION_TYPES,
  AUTH_TYPES,
  baseUrl,
  dataCategories,
  timeoutMs,
} = require('./integrationValidation');

function secretName(value) {
  const normalized = requiredText(value, 'credentialSecretName', 100);
  if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(normalized)) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'credentialSecretName must be an uppercase managed-secret reference'
    );
  }
  return normalized;
}

function audit(context, action, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: context.actorSubjectId,
    action,
    entityType: 'integration-connection',
    entityId,
    purpose: context.purpose,
    ...(metadata ? { metadata } : {}),
  };
}

function createIntegrationConnectionService(
  prismaClient,
  options = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const needsConfig = (
    options.allowInsecureLocalhost === undefined
    || options.allowedHosts === undefined
  );
  const config = needsConfig ? require('../config') : null;
  const {
    healthChecker,
    now = () => new Date(),
  } = options;
  const allowInsecureLocalhost = options.allowInsecureLocalhost
    ?? config.nodeEnv !== 'production';
  const allowedHosts = options.allowedHosts
    ?? config.integrations.allowedHosts;

  async function createConnection(context, input) {
    if (!INTEGRATION_TYPES.has(input.type)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'type is unsupported');
    }
    if (!AUTH_TYPES.has(input.authType)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'authType is unsupported');
    }
    if (input.type === 'FHIR_R4' && input.fhirVersion !== '4.0.1') {
      throw new DomainError(400, 'VALIDATION_ERROR', 'FHIR R4 version must be 4.0.1');
    }
    const dhis2ApiVersion = input.type === 'DHIS2'
      ? requiredText(input.dhis2ApiVersion, 'dhis2ApiVersion', 20)
      : null;
    if (dhis2ApiVersion && !/^\d{2,3}$/.test(dhis2ApiVersion)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'dhis2ApiVersion is invalid');
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const connection = await transaction.integrationConnection.create({
        data: {
          organizationId: context.organizationId,
          name: requiredText(input.name, 'name', 160),
          partnerIdentifier: requiredText(
            input.partnerIdentifier,
            'partnerIdentifier',
            160
          ),
          type: input.type,
          baseUrl: baseUrl(input.baseUrl, { allowInsecureLocalhost, allowedHosts }),
          authType: input.authType,
          credentialSecretName: secretName(input.credentialSecretName),
          ...(input.type === 'FHIR_R4'
            ? { fhirVersion: '4.0.1' }
            : { dhis2ApiVersion }),
          allowedDataCategories: dataCategories(input.allowedDataCategories),
          timeoutMs: timeoutMs(input.timeoutMs),
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'integration-connection.created', connection.id, {
          type: connection.type,
          partnerIdentifier: connection.partnerIdentifier,
        }),
      });
      return connection;
    });
  }

  async function checkHealth(context, connectionId) {
    if (!healthChecker) {
      throw new DomainError(
        503,
        'INTEGRATION_HEALTH_CHECKER_UNAVAILABLE',
        'Integration health checking is not configured'
      );
    }
    const connection = await withTenantTransaction(
      database,
      context.organizationId,
      (transaction) => transaction.integrationConnection.findFirst({
        where: { id: connectionId, organizationId: context.organizationId },
      })
    );
    if (!connection) {
      throw new DomainError(404, 'INTEGRATION_CONNECTION_NOT_FOUND', 'Connection not found');
    }
    let result;
    try {
      result = await healthChecker(connection);
    } catch (error) {
      result = {
        status: 'UNREACHABLE',
        errorCode: error instanceof DomainError
          ? error.code
          : 'INTEGRATION_HEALTH_CHECK_FAILED',
      };
    }
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const checkedAt = now();
      const updated = await transaction.integrationConnection.update({
        where: { id: connection.id },
        data: {
          lastHealthStatus: result.status,
          lastHealthCheckedAt: checkedAt,
          lastHealthErrorCode: result.errorCode || null,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'integration-connection.health-checked', connection.id, {
          status: result.status,
          errorCode: result.errorCode || null,
        }),
      });
      return updated;
    });
  }

  async function activate(context, connectionId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const healthyAfter = new Date(now().getTime() - 15 * 60 * 1000);
      const existing = await transaction.integrationConnection.findFirst({
        where: {
          id: connectionId,
          organizationId: context.organizationId,
          status: { in: ['DRAFT', 'SUSPENDED'] },
          lastHealthStatus: 'HEALTHY',
          lastHealthCheckedAt: { gte: healthyAfter },
        },
      });
      if (!existing) {
        throw new DomainError(
          409,
          'HEALTHY_INTEGRATION_CONNECTION_REQUIRED',
          'A recent healthy connection check is required before activation'
        );
      }
      const activatedAt = now();
      const connection = await transaction.integrationConnection.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          activatedBySubjectId: context.actorSubjectId,
          activatedAt: existing.activatedAt || activatedAt,
          suspendedAt: null,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'integration-connection.activated', connection.id),
      });
      return connection;
    });
  }

  async function suspend(context, connectionId, input) {
    const reason = requiredText(input.reason, 'reason', 500);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.integrationConnection.findFirst({
        where: {
          id: connectionId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      if (!existing) {
        throw new DomainError(404, 'ACTIVE_INTEGRATION_NOT_FOUND', 'Active connection not found');
      }
      const connection = await transaction.integrationConnection.update({
        where: { id: existing.id },
        data: { status: 'SUSPENDED', suspendedAt: now() },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'integration-connection.suspended', connection.id, { reason }),
      });
      return connection;
    });
  }

  return { createConnection, checkHealth, activate, suspend };
}

module.exports = {
  createIntegrationConnectionService,
  secretName,
};
