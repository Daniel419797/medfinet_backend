const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const { timestamp } = require('./clinicalService');
const { positiveCredits } = require('./credits');

const CAMPAIGN_TRANSITIONS = {
  DRAFT: new Set(['ACTIVE', 'CANCELLED']),
  ACTIVE: new Set(['PAUSED', 'CLOSED', 'CANCELLED']),
  PAUSED: new Set(['ACTIVE', 'CLOSED', 'CANCELLED']),
  CLOSED: new Set(),
  CANCELLED: new Set(),
};
const SOURCE_RECORD_TYPES = new Set(['IMMUNIZATION', 'GROWTH', 'APPOINTMENT']);

function normalizeMilestoneRules(rules) {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 50) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'milestoneRules must contain between 1 and 50 rules'
    );
  }
  const normalized = rules.map((rule) => {
    const sourceRecordType = requiredText(
      rule?.sourceRecordType,
      'sourceRecordType',
      40
    ).toUpperCase();
    if (!SOURCE_RECORD_TYPES.has(sourceRecordType)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'sourceRecordType is unsupported');
    }
    return {
      milestoneCode: requiredText(rule?.milestoneCode, 'milestoneCode', 100).toUpperCase(),
      sourceRecordType,
      credits: positiveCredits(rule?.credits).toString(),
      ...(rule.criteria ? { criteria: rule.criteria } : {}),
    };
  });
  if (
    new Set(normalized.map(({ milestoneCode }) => milestoneCode)).size
    !== normalized.length
  ) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'milestoneCode values must be unique');
  }
  return normalized;
}

function audit(context, action, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: context.actorSubjectId,
    action,
    entityType: 'reward-campaign',
    entityId,
    purpose: context.purpose,
    ...(metadata ? { metadata } : {}),
  };
}

function createRewardCampaignService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function createCampaign(context, input) {
    const startsAt = timestamp(input.startsAt, 'startsAt');
    const endsAt = timestamp(input.endsAt, 'endsAt');
    if (endsAt <= startsAt) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'endsAt must be later than startsAt');
    }
    const milestoneRules = normalizeMilestoneRules(input.milestoneRules);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      if (input.programmeId) {
        const programme = await transaction.programme.findFirst({
          where: {
            id: input.programmeId,
            organizationId: context.organizationId,
            isActive: true,
          },
          select: { id: true },
        });
        if (!programme) {
          throw new DomainError(404, 'PROGRAMME_NOT_FOUND', 'Active programme not found');
        }
      }
      const campaign = await transaction.rewardCampaign.create({
        data: {
          organizationId: context.organizationId,
          ...(input.programmeId ? { programmeId: input.programmeId } : {}),
          name: requiredText(input.name, 'name', 160),
          sponsorName: requiredText(input.sponsorName, 'sponsorName', 160),
          startsAt,
          endsAt,
          creditBudget: positiveCredits(input.creditBudget, 'creditBudget'),
          milestoneRules,
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'reward-campaign.created', campaign.id, {
          programmeId: campaign.programmeId,
          creditBudget: campaign.creditBudget.toString(),
        }),
      });
      return campaign;
    });
  }

  async function transitionCampaign(context, campaignId, input) {
    const targetStatus = input.status;
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.rewardCampaign.findFirst({
        where: { id: campaignId, organizationId: context.organizationId },
      });
      if (!existing) {
        throw new DomainError(404, 'REWARD_CAMPAIGN_NOT_FOUND', 'Reward campaign not found');
      }
      if (!CAMPAIGN_TRANSITIONS[existing.status]?.has(targetStatus)) {
        throw new DomainError(
          409,
          'INVALID_REWARD_CAMPAIGN_TRANSITION',
          `Reward campaign cannot transition from ${existing.status} to ${targetStatus}`
        );
      }
      const transitionTime = now();
      if (targetStatus === 'ACTIVE' && existing.endsAt <= transitionTime) {
        throw new DomainError(409, 'REWARD_CAMPAIGN_ENDED', 'An ended campaign cannot activate');
      }
      const campaign = await transaction.rewardCampaign.update({
        where: { id: existing.id },
        data: {
          status: targetStatus,
          ...(
            targetStatus === 'ACTIVE' && !existing.activatedAt
              ? {
                activatedAt: transitionTime,
                activatedBySubjectId: context.actorSubjectId,
              }
              : {}
          ),
          ...(targetStatus === 'CLOSED' ? { closedAt: transitionTime } : {}),
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'reward-campaign.status-changed', campaign.id, {
          from: existing.status,
          to: targetStatus,
        }),
      });
      return campaign;
    });
  }

  return { createCampaign, transitionCampaign };
}

module.exports = {
  createRewardCampaignService,
  normalizeMilestoneRules,
  CAMPAIGN_TRANSITIONS,
};
