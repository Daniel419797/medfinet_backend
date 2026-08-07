function optionalString(name, defaultValue) {
  return process.env[name]?.trim() || defaultValue;
}

function optionalNumber(name, defaultValue, { min, max } = {}) {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const value = Number(raw);
  if (
    !Number.isFinite(value)
    || (min !== undefined && value < min)
    || (max !== undefined && value > max)
  ) {
    throw new Error(
      `${name} must be a number${min !== undefined ? ` >= ${min}` : ''}${max !== undefined ? ` and <= ${max}` : ''}`
    );
  }
  return value;
}

function optionalInteger(name, defaultValue, options) {
  const value = optionalNumber(name, defaultValue, options);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function duplicateAliasGroups() {
  const raw = process.env.DUPLICATE_NAME_ALIASES_JSON?.trim();
  if (!raw) return [];
  let groups;
  try {
    groups = JSON.parse(raw);
  } catch {
    throw new Error('DUPLICATE_NAME_ALIASES_JSON must be valid JSON');
  }
  if (!Array.isArray(groups)) {
    throw new Error('DUPLICATE_NAME_ALIASES_JSON must be an array of name arrays');
  }
  return groups.map((group, index) => {
    if (
      !Array.isArray(group)
      || group.length < 2
      || group.some((name) => typeof name !== 'string' || !name.trim())
    ) {
      throw new Error(
        `DUPLICATE_NAME_ALIASES_JSON group ${index} must contain at least two non-empty names`
      );
    }
    return Object.freeze(group.map((name) => name.trim()));
  });
}

function loadRiskScoringConfig() {
  const duplicate = Object.freeze({
    version: optionalString('DUPLICATE_POLICY_VERSION', 'duplicate-risk-v1'),
    likelyThreshold: optionalNumber('DUPLICATE_LIKELY_THRESHOLD', 0.8, { min: 0, max: 1 }),
    possibleThreshold: optionalNumber('DUPLICATE_POSSIBLE_THRESHOLD', 0.5, { min: 0, max: 1 }),
    nameWeight: optionalNumber('DUPLICATE_NAME_WEIGHT', 0.55, { min: 0, max: 1 }),
    dateOfBirthWeight: optionalNumber('DUPLICATE_DOB_WEIGHT', 0.35, { min: 0, max: 1 }),
    sexWeight: optionalNumber('DUPLICATE_SEX_WEIGHT', 0.1, { min: 0, max: 1 }),
    swappedNamePenalty: optionalNumber('DUPLICATE_SWAPPED_NAME_PENALTY', 0.95, { min: 0, max: 1 }),
    swappedDateScore: optionalNumber('DUPLICATE_SWAPPED_DATE_SCORE', 0.75, { min: 0, max: 1 }),
    nearDateScore: optionalNumber('DUPLICATE_NEAR_DATE_SCORE', 0.6, { min: 0, max: 1 }),
    nearDateDays: optionalInteger('DUPLICATE_NEAR_DATE_DAYS', 1, { min: 0, max: 7 }),
    aliasGroups: Object.freeze(duplicateAliasGroups()),
  });
  if (duplicate.possibleThreshold >= duplicate.likelyThreshold) {
    throw new Error('DUPLICATE_POSSIBLE_THRESHOLD must be lower than DUPLICATE_LIKELY_THRESHOLD');
  }
  if (duplicate.nameWeight + duplicate.dateOfBirthWeight + duplicate.sexWeight <= 0) {
    throw new Error('Duplicate detection weights must have a positive total');
  }

  const reward = Object.freeze({
    version: optionalString('REWARD_ANOMALY_POLICY_VERSION', 'reward-risk-v1'),
    velocityThreshold: optionalInteger('REWARD_VELOCITY_THRESHOLD', 3, { min: 2, max: 100 }),
    velocityWindowHours: optionalNumber('REWARD_VELOCITY_WINDOW_HOURS', 24, { min: 1, max: 168 }),
    amountOutlierZThreshold: optionalNumber('REWARD_AMOUNT_OUTLIER_Z_THRESHOLD', 2.5, { min: 1, max: 10 }),
    minimumOutlierPeers: optionalInteger('REWARD_MINIMUM_OUTLIER_PEERS', 5, { min: 2, max: 499 }),
    merchantPriorSamples: optionalInteger('REWARD_MERCHANT_PRIOR_SAMPLES', 20, { min: 1, max: 10_000 }),
    dispersionFloorRatio: optionalNumber('REWARD_DISPERSION_FLOOR_RATIO', 0.1, { min: 0.01, max: 1 }),
    suspiciousScoreThreshold: optionalNumber('REWARD_SUSPICIOUS_SCORE_THRESHOLD', 0.6, { min: 0.1, max: 1 }),
    velocityWeight: optionalNumber('REWARD_VELOCITY_WEIGHT', 0.6, { min: 0, max: 1 }),
    reusedReferenceWeight: optionalNumber('REWARD_REUSED_REFERENCE_WEIGHT', 0.5, { min: 0, max: 1 }),
    amountOutlierWeight: optionalNumber('REWARD_AMOUNT_OUTLIER_WEIGHT', 0.5, { min: 0, max: 1 }),
  });
  if (reward.velocityWeight + reward.reusedReferenceWeight + reward.amountOutlierWeight <= 0) {
    throw new Error('Reward anomaly weights must have a positive total');
  }

  const climate = Object.freeze({
    version: optionalString('CLIMATE_RISK_POLICY_VERSION', 'climate-worklist-risk-v1'),
    displacedBonus: optionalNumber('CLIMATE_DISPLACED_BONUS', 10, { min: 0, max: 50 }),
    staleAssessmentDays: optionalInteger('CLIMATE_STALE_ASSESSMENT_DAYS', 180, { min: 1, max: 3650 }),
    staleAssessmentBonus: optionalNumber('CLIMATE_STALE_ASSESSMENT_BONUS', 5, { min: 0, max: 25 }),
    mediumThreshold: optionalNumber('CLIMATE_MEDIUM_THRESHOLD', 40, { min: 0, max: 100 }),
    highThreshold: optionalNumber('CLIMATE_HIGH_THRESHOLD', 65, { min: 0, max: 100 }),
    criticalThreshold: optionalNumber('CLIMATE_CRITICAL_THRESHOLD', 85, { min: 0, max: 100 }),
  });
  if (!(climate.mediumThreshold < climate.highThreshold && climate.highThreshold < climate.criticalThreshold)) {
    throw new Error('Climate risk thresholds must increase from medium to high to critical');
  }

  return Object.freeze({ duplicate, reward, climate });
}

module.exports = loadRiskScoringConfig();
