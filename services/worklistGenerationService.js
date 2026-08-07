const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { normalizeAreaCodes, vulnerabilityRange } = require('./worklistCriteria');
const {
  DEFAULT_CLIMATE_RISK_POLICY,
  resolveClimateRiskPolicy,
  priorityForRiskScore,
  computeClimateRisk,
} = require('./climateRiskScoring');

function audit(context, action, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: context.actorSubjectId,
    action,
    entityType: 'beneficiary-worklist',
    entityId,
    purpose: context.purpose,
    ...(metadata ? { metadata } : {}),
  };
}

function createWorklistGenerationService(
  prismaClient,
  { now = () => new Date(), policy: policyInput } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const policy = resolveClimateRiskPolicy(
    policyInput || require('../config/riskScoring').climate
  );

  async function requestGeneration(context, worklistId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const worklist = await transaction.beneficiaryWorklist.findFirst({
        where: {
          id: worklistId,
          organizationId: context.organizationId,
          status: 'DRAFT',
          generationComplete: false,
        },
      });
      if (!worklist) {
        throw new DomainError(
          409,
          'WORKLIST_NOT_GENERATABLE',
          'A draft, ungenerated worklist is required'
        );
      }
      const idempotencyKey = `worklist:${worklist.id}:generation:initial`;
      const event = await transaction.outboxEvent.upsert({
        where: {
          organizationId_idempotencyKey: {
            organizationId: context.organizationId,
            idempotencyKey,
          },
        },
        create: {
          organizationId: context.organizationId,
          eventType: 'WORKLIST_GENERATION_REQUESTED',
          aggregateType: 'beneficiary-worklist',
          aggregateId: worklist.id,
          idempotencyKey,
          payload: { worklistId: worklist.id },
        },
        update: {},
      });
      await transaction.auditEvent.create({
        data: audit(context, 'worklist.generation-requested', worklist.id, {
          scoringPolicyVersion: policy.version,
        }),
      });
      return {
        worklistId: worklist.id,
        outboxEventId: event.id,
        scoringPolicyVersion: policy.version,
      };
    });
  }

  async function processGenerationBatch(context, worklistId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const worklist = await transaction.beneficiaryWorklist.findFirst({
        where: {
          id: worklistId,
          organizationId: context.organizationId,
          status: 'DRAFT',
          generationComplete: false,
        },
      });
      if (!worklist) {
        return {
          worklistId,
          generationComplete: true,
          generatedCount: 0,
          skipped: true,
        };
      }
      const criteria = worklist.criteria;
      const profiles = await transaction.climateProfile.findMany({
        where: {
          organizationId: context.organizationId,
          administrativeAreaCode: { in: normalizeAreaCodes(criteria.administrativeAreaCodes) },
          vulnerability: { in: vulnerabilityRange(criteria.minimumVulnerability) },
          ...(criteria.displacedOnly ? { displaced: true } : {}),
          child: { status: 'ACTIVE' },
        },
        select: {
          childId: true,
          vulnerability: true,
          administrativeAreaCode: true,
          displaced: true,
          hazardExposure: true,
          assessedAt: true,
        },
        orderBy: { childId: 'asc' },
        take: 501,
        ...(worklist.generationCursor
          ? {
            cursor: {
              childId_organizationId: {
                childId: worklist.generationCursor,
                organizationId: context.organizationId,
              },
            },
            skip: 1,
          }
          : {}),
      });
      const hasMore = profiles.length > 500;
      const batchProfiles = profiles.slice(0, 500);
      const scoredAt = now();
      const scoredProfiles = batchProfiles.map((profile) => ({
        profile,
        risk: computeClimateRisk(profile, { assessedAt: scoredAt, policy }),
      }));
      const created = scoredProfiles.length
        ? await transaction.worklistEntry.createMany({
          data: scoredProfiles.map(({ profile, risk }) => ({
            organizationId: context.organizationId,
            worklistId,
            childId: profile.childId,
            eligibility: 'ELIGIBLE',
            eligibilityReason: [
              `Profile matched affected area ${profile.administrativeAreaCode}`,
              `deterministic risk score ${risk.score}/100`,
              `factors: ${risk.factors.join(', ')}`,
              `policy: ${risk.policyVersion}`,
            ].join('; '),
            priority: risk.priority,
          })),
          skipDuplicates: true,
        })
        : { count: 0 };
      const nextCursor = hasMore ? batchProfiles.at(-1).childId : null;
      const generated = await transaction.beneficiaryWorklist.update({
        where: { id: worklist.id },
        data: {
          generationComplete: !hasMore,
          generationCursor: nextCursor,
          generatedCount: { increment: created.count },
          ...(hasMore ? {} : { generatedAt: scoredAt }),
        },
      });
      if (hasMore) {
        await transaction.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'WORKLIST_GENERATION_REQUESTED',
            aggregateType: 'beneficiary-worklist',
            aggregateId: worklist.id,
            idempotencyKey: `worklist:${worklist.id}:generation:${nextCursor}`,
            payload: { worklistId: worklist.id },
          },
        });
      }
      const priorityCounts = scoredProfiles.reduce((counts, { risk }) => {
        counts[risk.priority] = (counts[risk.priority] || 0) + 1;
        return counts;
      }, {});
      const averageRiskScore = scoredProfiles.length === 0
        ? null
        : Math.round(
          scoredProfiles.reduce((total, { risk }) => total + risk.score, 0)
          / scoredProfiles.length
        );
      await transaction.auditEvent.create({
        data: audit(context, 'worklist.generation-batch', worklist.id, {
          batchEntryCount: created.count,
          generationComplete: !hasMore,
          nextCursor,
          scoringPolicyVersion: policy.version,
          priorityCounts,
          averageRiskScore,
        }),
      });
      return {
        worklist: generated,
        batchEntryCount: created.count,
        generationComplete: !hasMore,
        nextCursor,
        scoring: {
          policyVersion: policy.version,
          priorityCounts,
          averageRiskScore,
        },
      };
    });
  }

  return { requestGeneration, processGenerationBatch };
}

module.exports = {
  createWorklistGenerationService,
  computeClimateRisk,
  priorityForRiskScore,
  resolveClimateRiskPolicy,
  DEFAULT_CLIMATE_RISK_POLICY,
};
