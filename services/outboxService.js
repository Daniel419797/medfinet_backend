const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const MAX_ATTEMPTS = 10;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

function retryDelayMs(attempts) {
  return Math.min(60 * 60 * 1000, 1000 * (2 ** Math.max(0, attempts - 1)));
}

function createOutboxService(
  prismaClient,
  {
    handlers = {},
    now = () => new Date(),
    maxAttempts = MAX_ATTEMPTS,
    lockTimeoutMs = LOCK_TIMEOUT_MS,
    excludedEventTypes = [],
  } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function claimNext(context, workerId) {
    const normalizedWorkerId = requiredText(workerId, 'workerId', 120);
    const currentTime = now();
    const staleBefore = new Date(currentTime.valueOf() - lockTimeoutMs);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await transaction.outboxEvent.updateMany({
        where: {
          organizationId: context.organizationId,
          status: 'PROCESSING',
          lockedAt: { lt: staleBefore },
        },
        data: {
          status: 'FAILED',
          lockedAt: null,
          lockedBy: null,
          lastError: 'Worker lock expired before completion',
          nextAttemptAt: currentTime,
        },
      });
      const candidate = await transaction.outboxEvent.findFirst({
        where: {
          organizationId: context.organizationId,
          status: { in: ['PENDING', 'FAILED'] },
          attempts: { lt: maxAttempts },
          nextAttemptAt: { lte: currentTime },
          ...(excludedEventTypes.length
            ? { eventType: { notIn: excludedEventTypes } }
            : {}),
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      });
      if (!candidate) return null;
      const claimed = await transaction.outboxEvent.updateMany({
        where: {
          id: candidate.id,
          organizationId: context.organizationId,
          status: candidate.status,
          attempts: candidate.attempts,
        },
        data: {
          status: 'PROCESSING',
          attempts: { increment: 1 },
          lockedAt: currentTime,
          lockedBy: normalizedWorkerId,
          lastError: null,
        },
      });
      if (claimed.count !== 1) return null;
      return transaction.outboxEvent.findUnique({ where: { id: candidate.id } });
    });
  }

  async function markPublished(context, eventId, workerId) {
    const normalizedWorkerId = requiredText(workerId, 'workerId', 120);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const updated = await transaction.outboxEvent.updateMany({
        where: {
          id: eventId,
          organizationId: context.organizationId,
          status: 'PROCESSING',
          lockedBy: normalizedWorkerId,
        },
        data: {
          status: 'PUBLISHED',
          publishedAt: now(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'OUTBOX_LOCK_LOST',
          'The outbox event is no longer locked by this worker'
        );
      }
    });
  }

  async function markFailed(context, event, workerId, error) {
    const normalizedWorkerId = requiredText(workerId, 'workerId', 120);
    const currentTime = now();
    const deadLetter = event.attempts >= maxAttempts;
    const safeError = error instanceof DomainError
      ? `${error.code}: ${error.message}`
      : 'Background handler failed';
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const updated = await transaction.outboxEvent.updateMany({
        where: {
          id: event.id,
          organizationId: context.organizationId,
          status: 'PROCESSING',
          lockedBy: normalizedWorkerId,
        },
        data: {
          status: deadLetter ? 'DEAD_LETTER' : 'FAILED',
          nextAttemptAt: deadLetter
            ? currentTime
            : new Date(currentTime.valueOf() + retryDelayMs(event.attempts)),
          lockedAt: null,
          lockedBy: null,
          lastError: safeError.slice(0, 1000),
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          409,
          'OUTBOX_LOCK_LOST',
          'The outbox event is no longer locked by this worker'
        );
      }
    });
  }

  async function processNext(context, workerId) {
    const event = await claimNext(context, workerId);
    if (!event) return { processed: false };
    const handler = handlers[event.eventType];
    try {
      if (!handler) {
        throw new DomainError(
          503,
          'OUTBOX_HANDLER_UNAVAILABLE',
          `No handler is registered for ${event.eventType}`
        );
      }
      await handler(context, event);
      await markPublished(context, event.id, workerId);
      return { processed: true, eventId: event.id, status: 'PUBLISHED' };
    } catch (error) {
      await markFailed(context, event, workerId, error);
      return {
        processed: true,
        eventId: event.id,
        status: event.attempts >= maxAttempts ? 'DEAD_LETTER' : 'FAILED',
      };
    }
  }

  return { claimNext, markPublished, markFailed, processNext };
}

module.exports = {
  createOutboxService,
  retryDelayMs,
  MAX_ATTEMPTS,
  LOCK_TIMEOUT_MS,
};
