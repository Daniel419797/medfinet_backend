const { DomainError } = require('../../utils/domainError');
const { withTenantTransaction } = require('../tenantContext');

const MAX_CANDIDATES = 500;
const DEFAULT_LIMIT = 10;

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function bigrams(value) {
  const set = new Set();
  if (value.length === 1) {
    set.add(value);
    return set;
  }
  for (let index = 0; index < value.length - 1; index += 1) {
    set.add(value.slice(index, index + 2));
  }
  return set;
}

function jaccard(left, right) {
  if (!left.length || !right.length) return 0;
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  let intersection = 0;
  for (const gram of leftSet) {
    if (rightSet.has(gram)) intersection += 1;
  }
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function sameDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function scorePair(child, candidate) {
  const firstNameScore = jaccard(normalizeName(child.firstName), normalizeName(candidate.firstName));
  const lastNameScore = jaccard(normalizeName(child.lastName), normalizeName(candidate.lastName));
  const nameScore = (firstNameScore + lastNameScore) / 2;
  const dobExact = sameDay(child.dateOfBirth, candidate.dateOfBirth);
  const dobScore = dobExact ? 1 : 0;
  const sexScore = child.sex === candidate.sex ? 0.1 : 0;
  const score = Math.round((nameScore * 0.55 + dobScore * 0.35 + sexScore * 0.1) * 1000) / 1000;
  const matchedFields = [];
  if (nameScore >= 0.85) matchedFields.push('first_and_last_name');
  else if (firstNameScore >= 0.85 || lastNameScore >= 0.85) matchedFields.push('single_name');
  if (dobExact) matchedFields.push('date_of_birth');
  if (child.sex === candidate.sex) matchedFields.push('sex');
  return { score, matchedFields };
}

function statusFor(score) {
  if (score >= 0.8) return 'LIKELY_DUPLICATE';
  if (score >= 0.5) return 'POSSIBLE_DUPLICATE';
  return 'UNLIKELY';
}

function rulesDuplicates(child, candidates) {
  return candidates
    .map((candidate) => {
      const { score, matchedFields } = scorePair(child, candidate);
      return {
        childId: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        dateOfBirth: candidate.dateOfBirth,
        medfinetId: candidate.medfinetId,
        score,
        matchedFields,
        status: statusFor(score),
      };
    })
    .sort((left, right) => right.score - left.score);
}

function createDuplicateDetectionService(prismaClient, options = {}) {
  const database = prismaClient || require('../../utils/prisma').prisma;
  const ai = options.ai || (() => {
    const config = require('../../config');
    const { createAiClient } = require('./aiClient');
    return config.ai.enabled ? createAiClient(config.ai) : createAiClient({ provider: 'disabled' });
  })();

  async function detect(context, input) {
    const limit = input?.limit === undefined ? DEFAULT_LIMIT : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CANDIDATES) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'limit must be between 1 and 500');
    }
    const loaded = await withTenantTransaction(database, context.organizationId, async (transaction) => {
      const child = await transaction.child.findFirst({
        where: {
          id: input.childId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        select: { id: true, firstName: true, lastName: true, dateOfBirth: true, sex: true },
      });
      if (!child) {
        throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
      }
      const candidates = await transaction.child.findMany({
        where: {
          organizationId: context.organizationId,
          status: 'ACTIVE',
          id: { not: child.id },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          sex: true,
          medfinetId: true,
        },
        take: MAX_CANDIDATES,
      });
      return { child, candidates };
    });

    const ranked = rulesDuplicates(loaded.child, loaded.candidates).slice(0, Math.max(limit, 10));
    if (!ai.enabled || ranked.length === 0) {
      return {
        source: 'rules',
        model: null,
        items: ranked.slice(0, limit),
        note: ranked.length === 0
          ? 'No other children found in this organization.'
          : null,
      };
    }

    const fallback = () => ({ candidates: [] });
    const { value: reviewed, fellBack } = await ai.completeJson({
      system: [
        'You are a data quality assistant for a child health registry (Medfinet).',
        'Review the candidate duplicate records against the reference child.',
        'Decide for each candidate whether it is likely the SAME child (duplicate registration).',
        'Use the provided similarity score and matched fields as evidence. Do not rely on guesswork.',
        'Keep reasons to one short sentence each.',
      ].join('\n'),
      user: [
        `Reference child: ${JSON.stringify({ firstName: loaded.child.firstName, lastName: loaded.child.lastName, dateOfBirth: loaded.child.dateOfBirth.toISOString().slice(0, 10), sex: loaded.child.sex })}`,
        `Candidates: ${JSON.stringify(ranked.slice(0, 8).map((item) => ({
          childId: item.childId,
          firstName: item.firstName,
          lastName: item.lastName,
          dateOfBirth: item.dateOfBirth.toISOString().slice(0, 10),
          score: item.score,
          matchedFields: item.matchedFields,
        })))}`,
      ].join('\n\n'),
      schema: {
        candidates: [{ childId: 'string', likelyDuplicate: 'boolean', confidence: 'number', reason: 'string' }],
      },
      fallback,
      maxTokens: 400,
    });

    const reviewedSet = new Set((reviewed.candidates || []).map((item) => item.childId));
    const items = ranked.map((item) => {
      if (!reviewedSet.has(item.childId)) return item;
      const verdict = reviewed.candidates.find((entry) => entry.childId === item.childId);
      return {
        ...item,
        status: verdict?.likelyDuplicate ? 'LIKELY_DUPLICATE' : item.status,
        aiConfidence: verdict?.confidence ?? null,
        reason: verdict?.reason || null,
      };
    });
    return {
      source: fellBack ? 'rules' : 'ai',
      model: fellBack ? null : ai.model,
      items: items.slice(0, limit),
    };
  }

  return { detect };
}

module.exports = {
  createDuplicateDetectionService,
  scorePair,
  rulesDuplicates,
  statusFor,
  normalizeName,
};