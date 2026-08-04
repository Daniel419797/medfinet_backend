const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

function normalizeAuditQuery(input = {}, now = new Date()) {
  const limit = input.limit === undefined ? 50 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'limit must be between 1 and 1000'
    );
  }
  const to = input.to ? new Date(input.to) : now;
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (
    Number.isNaN(from.valueOf())
    || Number.isNaN(to.valueOf())
    || to <= from
    || to > now
    || to - from > MAX_RANGE_MS
  ) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'Audit range must be complete and no longer than 366 days'
    );
  }
  const exact = (value, field, maxLength) => {
    if (value === undefined) return undefined;
    if (
      typeof value !== 'string'
      || value.length < 1
      || value.length > maxLength
      || !/^[A-Za-z0-9._:-]+$/.test(value)
    ) {
      throw new DomainError(400, 'VALIDATION_ERROR', `${field} is invalid`);
    }
    return value;
  };
  return {
    limit,
    from,
    to,
    cursor: exact(input.cursor, 'cursor', 100),
    actorSubjectId: exact(input.actorSubjectId, 'actorSubjectId', 160),
    action: exact(input.action, 'action', 160),
    entityType: exact(input.entityType, 'entityType', 100),
    entityId: exact(input.entityId, 'entityId', 100),
  };
}

function createAuditQueryService(
  prismaClient,
  { now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function list(context, input) {
    const query = normalizeAuditQuery(input, now());
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.auditEvent.findMany({
        where: {
          organizationId: context.organizationId,
          createdAt: { gte: query.from, lt: query.to },
          ...(query.actorSubjectId
            ? { actorSubjectId: query.actorSubjectId }
            : {}),
          ...(query.action ? { action: query.action } : {}),
          ...(query.entityType ? { entityType: query.entityType } : {}),
          ...(query.entityId ? { entityId: query.entityId } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor
          ? { cursor: { id: query.cursor }, skip: 1 }
          : {}),
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      return {
        items,
        nextCursor: hasMore ? items.at(-1).id : null,
        range: { from: query.from, to: query.to },
      };
    });
  }

  return { list };
}

module.exports = {
  createAuditQueryService,
  normalizeAuditQuery,
  MAX_RANGE_MS,
};
