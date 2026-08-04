const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

function candidateOperation(transaction, category, organizationId, cutoffAt) {
  switch (category) {
    case 'NOTIFICATION_ATTEMPT':
      return {
        count: () => transaction.notificationDeliveryAttempt.count({
          where: {
            organizationId,
            status: { in: ['DELIVERED', 'FAILED'] },
            completedAt: { lt: cutoffAt },
          },
        }),
        remove: () => transaction.notificationDeliveryAttempt.deleteMany({
          where: {
            organizationId,
            status: { in: ['DELIVERED', 'FAILED'] },
            completedAt: { lt: cutoffAt },
          },
        }),
      };
    case 'INTEGRATION_STAGING':
      return {
        count: () => transaction.integrationImportStaging.count({
          where: {
            organizationId,
            status: { in: ['REJECTED', 'APPLIED', 'CONFLICT'] },
            updatedAt: { lt: cutoffAt },
          },
        }),
        remove: () => transaction.integrationImportStaging.deleteMany({
          where: {
            organizationId,
            status: { in: ['REJECTED', 'APPLIED', 'CONFLICT'] },
            updatedAt: { lt: cutoffAt },
          },
        }),
      };
    case 'PUBLISHED_OUTBOX':
      return {
        count: () => transaction.outboxEvent.count({
          where: {
            organizationId,
            status: { in: ['PUBLISHED', 'DEAD_LETTER'] },
            updatedAt: { lt: cutoffAt },
          },
        }),
        remove: () => transaction.outboxEvent.deleteMany({
          where: {
            organizationId,
            status: { in: ['PUBLISHED', 'DEAD_LETTER'] },
            updatedAt: { lt: cutoffAt },
          },
        }),
      };
    default:
      return null;
  }
}

function createRetentionExecutionService(
  prismaClient,
  { now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function preview(context, policyId, input) {
    const idempotencyKey = requiredText(
      input.idempotencyKey,
      'idempotencyKey',
      160
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.retentionExecutionRun.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: context.organizationId,
            idempotencyKey,
          },
        },
      });
      if (replay) return { run: replay, idempotentReplay: true };
      const policy = await transaction.dataRetentionPolicy.findFirst({
        where: {
          id: policyId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      if (!policy) {
        throw new DomainError(
          404,
          'ACTIVE_RETENTION_POLICY_NOT_FOUND',
          'Active retention policy not found'
        );
      }
      const cutoffAt = new Date(
        now().getTime() - policy.retentionDays * 24 * 60 * 60 * 1000
      );
      const operation = candidateOperation(
        transaction,
        policy.recordCategory,
        context.organizationId,
        cutoffAt
      );
      const candidateCount = operation ? await operation.count() : 0;
      const activeHoldCount = await transaction.legalHold.count({
        where: {
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      const run = await transaction.retentionExecutionRun.create({
        data: {
          organizationId: context.organizationId,
          policyId: policy.id,
          cutoffAt,
          candidateCount,
          excludedByHoldCount: activeHoldCount > 0 ? candidateCount : 0,
          previewedBySubjectId: context.actorSubjectId,
          idempotencyKey,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'retention-run.previewed',
          entityType: 'retention-execution-run',
          entityId: run.id,
          purpose: context.purpose,
          metadata: {
            recordCategory: policy.recordCategory,
            candidateCount,
            excludedByHoldCount: run.excludedByHoldCount,
            cutoffAt: cutoffAt.toISOString(),
          },
        },
      });
      return { run, idempotentReplay: false };
    });
  }

  async function approve(context, runId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const run = await transaction.retentionExecutionRun.findFirst({
        where: {
          id: runId,
          organizationId: context.organizationId,
          status: 'PREVIEWED',
        },
        include: { policy: true },
      });
      if (!run) {
        throw new DomainError(
          404,
          'RETENTION_RUN_NOT_APPROVABLE',
          'Previewed retention run not found'
        );
      }
      if (run.previewedBySubjectId === context.actorSubjectId) {
        throw new DomainError(
          409,
          'RETENTION_MAKER_CHECKER_REQUIRED',
          'A different administrator must approve retention'
        );
      }
      if (
        run.policy.disposition !== 'DELETE'
        || run.excludedByHoldCount > 0
      ) {
        throw new DomainError(
          409,
          'RETENTION_RUN_REQUIRES_REVIEW',
          'The run is review-only or blocked by an active legal hold'
        );
      }
      const approvedAt = now();
      const approved = await transaction.retentionExecutionRun.update({
        where: { id: run.id },
        data: {
          status: 'APPROVED',
          approvedBySubjectId: context.actorSubjectId,
          approvedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'retention-run.approved',
          entityType: 'retention-execution-run',
          entityId: run.id,
          purpose: context.purpose,
          metadata: { candidateCount: run.candidateCount },
        },
      });
      return approved;
    });
  }

  async function execute(context, runId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const run = await transaction.retentionExecutionRun.findFirst({
        where: {
          id: runId,
          organizationId: context.organizationId,
          status: 'APPROVED',
        },
        include: { policy: true },
      });
      if (!run) {
        throw new DomainError(
          404,
          'RETENTION_RUN_NOT_EXECUTABLE',
          'Approved retention run not found'
        );
      }
      const activeHold = await transaction.legalHold.count({
        where: {
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      if (activeHold > 0) {
        throw new DomainError(
          409,
          'RETENTION_BLOCKED_BY_LEGAL_HOLD',
          'An active legal hold blocks retention execution'
        );
      }
      const operation = candidateOperation(
        transaction,
        run.policy.recordCategory,
        context.organizationId,
        run.cutoffAt
      );
      if (!operation || run.policy.disposition !== 'DELETE') {
        throw new DomainError(
          409,
          'UNSAFE_RETENTION_EXECUTION',
          'This retention category cannot be automatically deleted'
        );
      }
      const currentCandidateCount = await operation.count();
      if (currentCandidateCount !== run.candidateCount) {
        throw new DomainError(
          409,
          'RETENTION_PREVIEW_STALE',
          'Retention candidates changed; create and approve a new preview'
        );
      }
      await transaction.retentionExecutionRun.update({
        where: { id: run.id },
        data: {
          status: 'EXECUTING',
          executedBySubjectId: context.actorSubjectId,
        },
      });
      const removal = await operation.remove();
      const executedAt = now();
      const completed = await transaction.retentionExecutionRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          affectedCount: removal.count,
          executedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorSubjectId: context.actorSubjectId,
          action: 'retention-run.completed',
          entityType: 'retention-execution-run',
          entityId: run.id,
          purpose: context.purpose,
          metadata: {
            recordCategory: run.policy.recordCategory,
            affectedCount: removal.count,
            cutoffAt: run.cutoffAt.toISOString(),
          },
        },
      });
      return completed;
    });
  }

  return { preview, approve, execute };
}

module.exports = {
  createRetentionExecutionService,
  candidateOperation,
};
