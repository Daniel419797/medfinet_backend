const { DomainError } = require('../../utils/domainError');
const { withTenantTransaction } = require('../tenantContext');

const MAX_CANDIDATES = 500;
const DEFAULT_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_DUPLICATE_POLICY = Object.freeze({
  version: 'duplicate-risk-v1',
  likelyThreshold: 0.8,
  possibleThreshold: 0.5,
  nameWeight: 0.55,
  dateOfBirthWeight: 0.35,
  sexWeight: 0.1,
  swappedNamePenalty: 0.95,
  swappedDateScore: 0.75,
  nearDateScore: 0.6,
  nearDateDays: 1,
  aliasGroups: Object.freeze([]),
});

function normalizedText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeAliasGroups(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'duplicate aliasGroups must be an array');
  }
  return value.map((group, index) => {
    if (!Array.isArray(group) || group.length < 2) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        `duplicate aliasGroups[${index}] must contain at least two names`
      );
    }
    const names = [...new Set(group.map(normalizedText).filter(Boolean))];
    if (names.length < 2) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        `duplicate aliasGroups[${index}] must contain at least two distinct names`
      );
    }
    return Object.freeze(names);
  });
}

function buildAliasMap(aliasGroups = []) {
  const aliases = new Map();
  for (const group of aliasGroups) {
    const canonical = group[0];
    for (const name of group) aliases.set(name, canonical);
  }
  return aliases;
}

function normalizeName(value, aliasGroupsOrMap = []) {
  const normalized = normalizedText(value);
  const aliases = aliasGroupsOrMap instanceof Map
    ? aliasGroupsOrMap
    : buildAliasMap(normalizeAliasGroups(aliasGroupsOrMap));
  return aliases.get(normalized) || normalized;
}

function boundedPolicyNumber(value, fallback, field, { min = 0, max = 1 } = {}) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a number between ${min} and ${max}`
    );
  }
  return parsed;
}

function resolveDuplicatePolicy(input = {}) {
  const likelyThreshold = boundedPolicyNumber(
    input.likelyThreshold,
    DEFAULT_DUPLICATE_POLICY.likelyThreshold,
    'duplicate likelyThreshold'
  );
  const possibleThreshold = boundedPolicyNumber(
    input.possibleThreshold,
    DEFAULT_DUPLICATE_POLICY.possibleThreshold,
    'duplicate possibleThreshold'
  );
  if (possibleThreshold >= likelyThreshold) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'duplicate possibleThreshold must be lower than likelyThreshold'
    );
  }
  const weights = {
    name: boundedPolicyNumber(
      input.nameWeight,
      DEFAULT_DUPLICATE_POLICY.nameWeight,
      'duplicate nameWeight'
    ),
    dateOfBirth: boundedPolicyNumber(
      input.dateOfBirthWeight,
      DEFAULT_DUPLICATE_POLICY.dateOfBirthWeight,
      'duplicate dateOfBirthWeight'
    ),
    sex: boundedPolicyNumber(
      input.sexWeight,
      DEFAULT_DUPLICATE_POLICY.sexWeight,
      'duplicate sexWeight'
    ),
  };
  const totalWeight = weights.name + weights.dateOfBirth + weights.sex;
  if (totalWeight <= 0) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'duplicate scoring weights must be positive');
  }
  const nearDateDays = input.nearDateDays === undefined
    ? DEFAULT_DUPLICATE_POLICY.nearDateDays
    : Number(input.nearDateDays);
  if (!Number.isInteger(nearDateDays) || nearDateDays < 0 || nearDateDays > 7) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'duplicate nearDateDays must be an integer between 0 and 7'
    );
  }
  const aliasGroups = normalizeAliasGroups(input.aliasGroups);
  return Object.freeze({
    version: String(input.version || DEFAULT_DUPLICATE_POLICY.version),
    likelyThreshold,
    possibleThreshold,
    nameWeight: weights.name / totalWeight,
    dateOfBirthWeight: weights.dateOfBirth / totalWeight,
    sexWeight: weights.sex / totalWeight,
    swappedNamePenalty: boundedPolicyNumber(
      input.swappedNamePenalty,
      DEFAULT_DUPLICATE_POLICY.swappedNamePenalty,
      'duplicate swappedNamePenalty'
    ),
    swappedDateScore: boundedPolicyNumber(
      input.swappedDateScore,
      DEFAULT_DUPLICATE_POLICY.swappedDateScore,
      'duplicate swappedDateScore'
    ),
    nearDateScore: boundedPolicyNumber(
      input.nearDateScore,
      DEFAULT_DUPLICATE_POLICY.nearDateScore,
      'duplicate nearDateScore'
    ),
    nearDateDays,
    aliasGroups: Object.freeze(aliasGroups),
  });
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

function editSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  if (left === right) return 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        substitution
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return 1 - (previous[right.length] / Math.max(left.length, right.length));
}

function nameSimilarity(left, right, aliases) {
  const normalizedLeft = normalizeName(left, aliases);
  const normalizedRight = normalizeName(right, aliases);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  return Math.max(
    jaccard(normalizedLeft, normalizedRight),
    editSimilarity(normalizedLeft, normalizedRight)
  );
}

function sameDay(left, right) {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

function dateOnlyTime(value) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function dateOfBirthSimilarity(left, right, policy) {
  if (sameDay(left, right)) return { score: 1, matchedField: 'date_of_birth' };
  const sameYear = left.getUTCFullYear() === right.getUTCFullYear();
  const leftMonth = left.getUTCMonth() + 1;
  const rightMonth = right.getUTCMonth() + 1;
  const leftDay = left.getUTCDate();
  const rightDay = right.getUTCDate();
  if (
    sameYear
    && leftDay <= 12
    && rightDay <= 12
    && leftDay === rightMonth
    && leftMonth === rightDay
  ) {
    return {
      score: policy.swappedDateScore,
      matchedField: 'date_of_birth_day_month_swapped',
    };
  }
  const differenceDays = Math.abs(dateOnlyTime(left) - dateOnlyTime(right)) / DAY_MS;
  if (policy.nearDateDays > 0 && differenceDays <= policy.nearDateDays) {
    return { score: policy.nearDateScore, matchedField: 'date_of_birth_near' };
  }
  return { score: 0, matchedField: null };
}

function scorePair(child, candidate, policyInput = {}) {
  const policy = resolveDuplicatePolicy(policyInput);
  const aliases = buildAliasMap(policy.aliasGroups);
  const firstNameScore = nameSimilarity(child.firstName, candidate.firstName, aliases);
  const lastNameScore = nameSimilarity(child.lastName, candidate.lastName, aliases);
  const directNameScore = (firstNameScore + lastNameScore) / 2;
  const swappedFirstNameScore = nameSimilarity(child.firstName, candidate.lastName, aliases);
  const swappedLastNameScore = nameSimilarity(child.lastName, candidate.firstName, aliases);
  const swappedNameScore = (
    (swappedFirstNameScore + swappedLastNameScore) / 2
  ) * policy.swappedNamePenalty;
  const namesSwapped = swappedNameScore > directNameScore;
  const nameScore = Math.max(directNameScore, swappedNameScore);
  const dateOfBirth = dateOfBirthSimilarity(child.dateOfBirth, candidate.dateOfBirth, policy);
  const sexScore = child.sex === candidate.sex ? 1 : 0;
  const score = Math.round((
    nameScore * policy.nameWeight
    + dateOfBirth.score * policy.dateOfBirthWeight
    + sexScore * policy.sexWeight
  ) * 1000) / 1000;
  const matchedFields = [];
  if (namesSwapped && nameScore >= 0.85) matchedFields.push('first_and_last_name_swapped');
  else if (nameScore >= 0.85) matchedFields.push('first_and_last_name');
  else if (firstNameScore >= 0.85 || lastNameScore >= 0.85) matchedFields.push('single_name');
  if (dateOfBirth.matchedField) matchedFields.push(dateOfBirth.matchedField);
  if (sexScore === 1) matchedFields.push('sex');
  return {
    score,
    matchedFields,
    components: {
      name: Math.round(nameScore * 1000) / 1000,
      dateOfBirth: dateOfBirth.score,
      sex: sexScore,
    },
  };
}

function statusFor(score, policyInput = {}) {
  const policy = resolveDuplicatePolicy(policyInput);
  if (score >= policy.likelyThreshold) return 'LIKELY_DUPLICATE';
  if (score >= policy.possibleThreshold) return 'POSSIBLE_DUPLICATE';
  return 'UNLIKELY';
}

function rulesDuplicates(child, candidates, policyInput = {}) {
  const policy = resolveDuplicatePolicy(policyInput);
  return candidates
    .map((candidate) => {
      const { score, matchedFields, components } = scorePair(child, candidate, policy);
      return {
        childId: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        dateOfBirth: candidate.dateOfBirth,
        medfinetId: candidate.medfinetId,
        score,
        components,
        matchedFields,
        status: statusFor(score, policy),
      };
    })
    .sort((left, right) => right.score - left.score);
}

function createDuplicateDetectionService(prismaClient, options = {}) {
  const database = prismaClient || require('../../utils/prisma').prisma;
  const policy = resolveDuplicatePolicy(
    options.policy || require('../../config/riskScoring').duplicate
  );
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

    const ranked = rulesDuplicates(loaded.child, loaded.candidates, policy)
      .slice(0, Math.max(limit, 10));
    if (!ai.enabled || ranked.length === 0) {
      return {
        source: 'rules',
        model: null,
        policyVersion: policy.version,
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
        'Use only the provided deterministic score components and matched fields as evidence.',
        'Do not override a low deterministic score through guesswork.',
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
          components: item.components,
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
      policyVersion: policy.version,
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
  nameSimilarity,
  dateOfBirthSimilarity,
  resolveDuplicatePolicy,
  DEFAULT_DUPLICATE_POLICY,
};
