const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { positiveCredits } = require('./credits');
const {
  ledgerEntries,
  householdAvailable,
  campaignExpense,
} = require('./rewardLedger');

function matchingRule(campaign, milestoneCode, sourceRecordType) {
  const rules = Array.isArray(campaign.milestoneRules)
    ? campaign.milestoneRules
    : [];
  return rules.find((rule) => (
    rule.milestoneCode === milestoneCode
    && rule.sourceRecordType === sourceRecordType
  ));
}

function recordMatchesCriteria(record, sourceRecordType, criteria = {}) {
  const allowed = {
    IMMUNIZATION: ['vaccineCode', 'doseNumber'],
    GROWTH: ['vitaminAAdministered'],
    APPOINTMENT: ['kind', 'status'],
  }[sourceRecordType] || [];
  return Object.entries(criteria).every(([key, value]) => (
    allowed.includes(key) && record[key] === value
  ));
}

async function findSourceRecord(transaction, context, childId, sourceRecordType, sourceRecordId) {
  const where = {
    id: sourceRecordId,
    organizationId: context.organizationId,
    childId,
  };
  if (sourceRecordType === 'IMMUNIZATION') {
    return transaction.immunizationRecord.findFirst({
      where: { ...where, status: 'ACTIVE' },
    });
  }
  if (sourceRecordType === 'GROWTH') {
    return transaction.growthMeasurement.findFirst({
      where: { ...where, status: 'ACTIVE' },
    });
  }
  if (sourceRecordType === 'APPOINTMENT') {
    return transaction.appointment.findFirst({
      where: { ...where, status: 'COMPLETED' },
    });
  }
  return null;
}

function createRewardGrantService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function grantMilestone(context, campaignId, childId, input) {
    const milestoneCode = requiredText(
      input.milestoneCode,
      'milestoneCode',
      100
    ).toUpperCase();
    const sourceRecordType = requiredText(
      input.sourceRecordType,
      'sourceRecordType',
      40
    ).toUpperCase();
    const sourceRecordId = requiredText(input.sourceRecordId, 'sourceRecordId', 100);
    const currentTime = now();

    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const replay = await transaction.rewardGrant.findUnique({
        where: {
          rewardCampaignId_childId_milestoneCode: {
            rewardCampaignId: campaignId,
            childId,
            milestoneCode,
          },
        },
        include: { rewardAccount: true, transaction: true },
      });
      if (replay) return { grant: replay, idempotentReplay: true };

      const campaign = await transaction.rewardCampaign.findFirst({
        where: {
          id: campaignId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          startsAt: { lte: currentTime },
          endsAt: { gt: currentTime },
        },
      });
      if (!campaign) {
        throw new DomainError(
          404,
          'ACTIVE_REWARD_CAMPAIGN_NOT_FOUND',
          'Active reward campaign not found'
        );
      }
      const rule = matchingRule(campaign, milestoneCode, sourceRecordType);
      if (!rule) {
        throw new DomainError(
          400,
          'REWARD_RULE_NOT_FOUND',
          'The campaign has no matching milestone rule'
        );
      }
      const sourceRecord = await findSourceRecord(
        transaction,
        context,
        childId,
        sourceRecordType,
        sourceRecordId
      );
      if (!sourceRecord || !recordMatchesCriteria(sourceRecord, sourceRecordType, rule.criteria)) {
        throw new DomainError(
          409,
          'MILESTONE_CRITERIA_NOT_MET',
          'The source record does not satisfy the campaign milestone'
        );
      }
      const caregiverLink = await transaction.childCaregiver.findFirst({
        where: {
          organizationId: context.organizationId,
          childId,
          isPrimary: true,
          hasConsentAuthority: true,
        },
        select: { caregiverId: true },
      });
      if (!caregiverLink) {
        throw new DomainError(
          409,
          'PRIMARY_CAREGIVER_REQUIRED',
          'A primary caregiver with consent authority is required'
        );
      }
      const account = await transaction.rewardAccount.upsert({
        where: {
          caregiverId_organizationId: {
            caregiverId: caregiverLink.caregiverId,
            organizationId: context.organizationId,
          },
        },
        create: {
          organizationId: context.organizationId,
          caregiverId: caregiverLink.caregiverId,
        },
        update: {},
      });
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "reward_accounts" WHERE "id" = $1 FOR UPDATE',
        account.id
      );
      const credits = positiveCredits(rule.credits);
      const campaignBudget = await transaction.rewardCampaign.updateMany({
        where: {
          id: campaign.id,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          creditsIssued: { lte: campaign.creditBudget - credits },
        },
        data: { creditsIssued: { increment: credits } },
      });
      if (campaignBudget.count !== 1) {
        throw new DomainError(
          409,
          'REWARD_CAMPAIGN_BUDGET_EXHAUSTED',
          'The campaign does not have enough remaining credits'
        );
      }
      const updatedAccount = await transaction.rewardAccount.update({
        where: { id: account.id },
        data: {
          balance: { increment: credits },
          version: { increment: 1 },
        },
      });
      const idempotencyKey = `reward-grant:${campaign.id}:${childId}:${milestoneCode}`;
      const ledgerTransaction = await transaction.rewardTransaction.create({
        data: {
          organizationId: context.organizationId,
          rewardAccountId: account.id,
          rewardCampaignId: campaign.id,
          type: 'EARN',
          amount: credits,
          balanceAfter: updatedAccount.balance,
          reservedBalanceAfter: updatedAccount.reservedBalance,
          idempotencyKey,
          referenceType: sourceRecordType,
          referenceId: sourceRecordId,
          metadata: { childId, milestoneCode },
          createdBySubjectId: context.actorSubjectId,
          entries: ledgerEntries(
            context.organizationId,
            campaignExpense(campaign.id),
            householdAvailable(account.id),
            credits
          ),
        },
      });
      const grant = await transaction.rewardGrant.create({
        data: {
          organizationId: context.organizationId,
          rewardCampaignId: campaign.id,
          rewardAccountId: account.id,
          childId,
          milestoneCode,
          credits,
          sourceRecordType,
          sourceRecordId,
          transactionId: ledgerTransaction.id,
          grantedBySubjectId: context.actorSubjectId,
        },
      });
      await Promise.all([
        transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'REWARD_GRANTED',
            aggregateType: 'reward-grant',
            aggregateId: grant.id,
            idempotencyKey: `reward-grant:${grant.id}:notification`,
            payload: {
              rewardGrantId: grant.id,
              caregiverId: caregiverLink.caregiverId,
            },
          },
        }),
        transaction.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorSubjectId: context.actorSubjectId,
            action: 'reward.granted',
            entityType: 'reward-grant',
            entityId: grant.id,
            purpose: context.purpose,
            metadata: {
              childId,
              campaignId: campaign.id,
              milestoneCode,
              credits: credits.toString(),
            },
          },
        }),
      ]);
      return {
        grant,
        account: updatedAccount,
        transaction: ledgerTransaction,
        idempotentReplay: false,
      };
    });
  }

  return { grantMilestone };
}

module.exports = {
  createRewardGrantService,
  matchingRule,
  recordMatchesCriteria,
};
