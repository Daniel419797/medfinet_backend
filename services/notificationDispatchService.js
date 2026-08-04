const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { createNotificationAdapters } = require('./notificationAdapters');

function destination(message) {
  if (message.channel === 'EMAIL') return message.caregiver?.email || null;
  if (message.channel === 'SMS') return message.caregiver?.phone || null;
  if (message.channel === 'PUSH') return message.recipientSubjectId;
  return message.recipientSubjectId;
}

function safeFailureCode(error) {
  return error instanceof DomainError
    ? error.code
    : 'NOTIFICATION_PROVIDER_FAILURE';
}

function createNotificationDispatchService(
  prismaClient,
  { adapters, now = () => new Date(), lockTimeoutMs = 5 * 60 * 1000 } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const configuredAdapters = adapters || createNotificationAdapters(
    require('../config')
  );

  async function claim(context, messageId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const currentTime = now();
      await transaction.notificationMessage.updateMany({
        where: {
          id: messageId,
          organizationId: context.organizationId,
          status: 'PROCESSING',
          updatedAt: { lt: new Date(currentTime.getTime() - lockTimeoutMs) },
        },
        data: { status: 'FAILED', failedAt: currentTime },
      });
      const message = await transaction.notificationMessage.findFirst({
        where: {
          id: messageId,
          organizationId: context.organizationId,
          status: { in: ['QUEUED', 'FAILED'] },
          scheduledAt: { lte: currentTime },
        },
        include: { caregiver: true },
      });
      if (!message) {
        const completed = await transaction.notificationMessage.findFirst({
          where: { id: messageId, organizationId: context.organizationId },
        });
        if (completed && ['SENT', 'DELIVERED', 'SUPPRESSED'].includes(completed.status)) {
          return { completed };
        }
        throw new DomainError(
          409,
          'NOTIFICATION_NOT_DISPATCHABLE',
          'Notification is not ready for dispatch'
        );
      }
      const explicitPreference = await transaction.notificationPreference.findUnique({
        where: {
          organizationId_subjectId_category_channel: {
            organizationId: context.organizationId,
            subjectId: message.recipientSubjectId,
            category: message.category,
            channel: message.channel,
          },
        },
      });
      if (explicitPreference?.enabled === false) {
        const suppressed = await transaction.notificationMessage.update({
          where: { id: message.id },
          data: {
            status: 'SUPPRESSED',
            suppressedReason: 'RECIPIENT_OPTED_OUT',
          },
        });
        return { completed: suppressed };
      }
      const updated = await transaction.notificationMessage.updateMany({
        where: {
          id: message.id,
          organizationId: context.organizationId,
          status: message.status,
        },
        data: { status: 'PROCESSING', failedAt: null },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'NOTIFICATION_CLAIM_CONFLICT',
          'Notification was claimed by another worker'
        );
      }
      const attempts = await transaction.notificationDeliveryAttempt.count({
        where: {
          organizationId: context.organizationId,
          notificationMessageId: message.id,
        },
      });
      const attempt = await transaction.notificationDeliveryAttempt.create({
        data: {
          organizationId: context.organizationId,
          notificationMessageId: message.id,
          attemptNumber: attempts + 1,
          provider: configuredAdapters[message.channel]?.name || 'unavailable',
          status: 'STARTED',
        },
      });
      return { message, attempt };
    });
  }

  async function dispatch(context, messageId) {
    const claimed = await claim(context, messageId);
    if (claimed.completed) {
      return { message: claimed.completed, idempotentReplay: true };
    }
    const { message, attempt } = claimed;
    const adapter = configuredAdapters[message.channel];
    try {
      if (!adapter) {
        throw new DomainError(
          503,
          'NOTIFICATION_ADAPTER_UNAVAILABLE',
          `No adapter is configured for ${message.channel}`
        );
      }
      const result = await adapter.send({
        message,
        destination: destination(message),
      });
      return withTenantTransaction(database, context.organizationId, async (transaction) => {
        const completedAt = now();
        await transaction.notificationDeliveryAttempt.update({
          where: { id: attempt.id },
          data: {
            status: result.status,
            providerMessageId: result.providerMessageId,
            responseCode: result.responseCode,
            completedAt,
          },
        });
        const delivered = result.status === 'DELIVERED';
        const updatedMessage = await transaction.notificationMessage.update({
          where: { id: message.id },
          data: {
            status: delivered ? 'DELIVERED' : 'SENT',
            sentAt: completedAt,
            ...(delivered ? { deliveredAt: completedAt } : {}),
          },
        });
        return { message: updatedMessage, attempt, idempotentReplay: false };
      });
    } catch (error) {
      await withTenantTransaction(database, context.organizationId, async (transaction) => {
        const completedAt = now();
        await Promise.all([
          transaction.notificationDeliveryAttempt.update({
            where: { id: attempt.id },
            data: {
              status: 'FAILED',
              failureCode: safeFailureCode(error),
              completedAt,
            },
          }),
          transaction.notificationMessage.update({
            where: { id: message.id },
            data: { status: 'FAILED', failedAt: completedAt },
          }),
        ]);
      });
      throw error;
    }
  }

  async function markDelivered(context, provider, providerMessageId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const attempt = await transaction.notificationDeliveryAttempt.findFirst({
        where: {
          organizationId: context.organizationId,
          provider,
          providerMessageId,
          status: { in: ['ACCEPTED', 'DELIVERED'] },
        },
      });
      if (!attempt) {
        throw new DomainError(
          404,
          'NOTIFICATION_ATTEMPT_NOT_FOUND',
          'Accepted notification attempt not found'
        );
      }
      if (attempt.status === 'DELIVERED') {
        return transaction.notificationMessage.findUnique({
          where: { id: attempt.notificationMessageId },
        });
      }
      const deliveredAt = now();
      const [, message] = await Promise.all([
        transaction.notificationDeliveryAttempt.update({
          where: { id: attempt.id },
          data: { status: 'DELIVERED', completedAt: deliveredAt },
        }),
        transaction.notificationMessage.update({
          where: { id: attempt.notificationMessageId },
          data: { status: 'DELIVERED', deliveredAt },
        }),
      ]);
      return message;
    });
  }

  return { claim, dispatch, markDelivered };
}

module.exports = {
  createNotificationDispatchService,
  destination,
  safeFailureCode,
};
