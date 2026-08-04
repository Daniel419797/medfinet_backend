const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

function limit(value) {
  const normalized = value === undefined ? 25 : Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 100) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 100');
  }
  return normalized;
}

function createNotificationInboxService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function list(context, input = {}) {
    const take = limit(input.limit);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const rows = await transaction.notificationMessage.findMany({
        where: {
          organizationId: context.organizationId,
          recipientSubjectId: context.actorSubjectId,
          channel: 'IN_APP',
          status: { in: ['SENT', 'DELIVERED'] },
          ...(input.unread === 'true' ? { readAt: null } : {}),
        },
        select: {
          id: true,
          category: true,
          renderedSubject: true,
          renderedBody: true,
          status: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > take;
      const items = hasMore ? rows.slice(0, take) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    });
  }

  async function markRead(context, messageId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const updated = await transaction.notificationMessage.updateMany({
        where: {
          id: messageId,
          organizationId: context.organizationId,
          recipientSubjectId: context.actorSubjectId,
          channel: 'IN_APP',
          status: { in: ['SENT', 'DELIVERED'] },
        },
        data: { readAt: now() },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          404,
          'IN_APP_NOTIFICATION_NOT_FOUND',
          'In-app notification not found'
        );
      }
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'notification.read',
          entityType: 'notification-message',
          entityId: messageId,
          purpose: context.purpose,
        },
      });
      return transaction.notificationMessage.findUnique({ where: { id: messageId } });
    });
  }

  return { list, markRead };
}

module.exports = { createNotificationInboxService, limit };
