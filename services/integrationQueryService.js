const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

function pagination(input = {}) {
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100');
  }
  return {
    limit,
    query: {
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    },
  };
}

function result(rows, limit) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
}

function createIntegrationQueryService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function listConnections(context, input) {
    const page = pagination(input);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.integrationConnection.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.type ? { type: input.type } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        select: {
          id: true,
          name: true,
          partnerIdentifier: true,
          type: true,
          status: true,
          baseUrl: true,
          authType: true,
          fhirVersion: true,
          dhis2ApiVersion: true,
          allowedDataCategories: true,
          timeoutMs: true,
          lastHealthStatus: true,
          lastHealthCheckedAt: true,
          lastHealthErrorCode: true,
          activatedAt: true,
          suspendedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page.query,
      });
      return result(rows, page.limit);
    });
  }

  async function listMappings(context, connectionId, input) {
    const page = pagination(input);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.integrationMapping.findMany({
        where: {
          organizationId: context.organizationId,
          connectionId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.direction ? { direction: input.direction } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page.query,
      });
      return result(rows, page.limit);
    });
  }

  async function listJobs(context, input) {
    const page = pagination(input);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.integrationJob.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.direction ? { direction: input.direction } : {}),
        },
        select: {
          id: true,
          connectionId: true,
          mappingId: true,
          direction: true,
          resourceType: true,
          status: true,
          recordsDiscovered: true,
          recordsSucceeded: true,
          recordsFailed: true,
          startedAt: true,
          completedAt: true,
          failedAt: true,
          lastErrorCode: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page.query,
      });
      return result(rows, page.limit);
    });
  }

  async function listReconciliations(context, input) {
    const page = pagination(input);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.integrationReconciliationRun.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          connection: { select: { id: true, name: true, type: true } },
          job: { select: { id: true, resourceType: true, status: true } },
        },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        ...page.query,
      });
      return result(rows, page.limit);
    });
  }

  async function getReconciliation(context, runId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const run = await transaction.integrationReconciliationRun.findFirst({
        where: { id: runId, organizationId: context.organizationId },
        include: {
          connection: { select: { id: true, name: true, type: true } },
          job: { select: { id: true, resourceType: true, status: true } },
        },
      });
      if (!run) {
        throw new DomainError(
          404,
          'INTEGRATION_RECONCILIATION_NOT_FOUND',
          'Reconciliation run not found'
        );
      }
      return run;
    });
  }

  return {
    listConnections,
    listMappings,
    listJobs,
    listReconciliations,
    getReconciliation,
  };
}

module.exports = {
  createIntegrationQueryService,
  pagination,
  result,
};
