const METRIC_CATALOG = Object.freeze({
  registered_children: {
    label: 'Registered children',
    description: 'Active child records registered by the end of the reporting period.',
    unit: 'COUNT',
  },
  immunization_reach: {
    label: 'Immunization reach',
    description: 'Active registered children with an active immunization in the period.',
    unit: 'PERCENT',
  },
  vitamin_a_reach: {
    label: 'Vitamin A reach',
    description: 'Active registered children with Vitamin A recorded in the period.',
    unit: 'PERCENT',
  },
  eligible_worklist_completion: {
    label: 'Eligible worklist completion',
    description: 'Eligible worklist entries completed in the reporting period.',
    unit: 'PERCENT',
  },
  referral_completion: {
    label: 'Referral completion',
    description: 'Referrals opened in the period that reached a completed state.',
    unit: 'PERCENT',
  },
  service_deliveries: {
    label: 'Service deliveries',
    description: 'Verified service-delivery records created in the reporting period.',
    unit: 'COUNT',
  },
});

function percentageMetric(metricKey, numerator, denominator) {
  return {
    metricKey,
    numerator,
    denominator,
    valueBasisPoints: denominator === 0
      ? 0
      : Math.round((numerator * 10000) / denominator),
    unit: 'PERCENT',
    cohortSize: denominator,
  };
}

async function calculateOrganizationMetrics(transaction, organizationId, period) {
  const window = { gte: period.periodStart, lt: period.periodEnd };
  const activeChildren = {
    organizationId,
    status: 'ACTIVE',
    createdAt: { lt: period.periodEnd },
  };
  const [
    registeredChildren,
    immunizedChildren,
    vitaminAChildren,
    eligibleEntries,
    completedEligibleEntries,
    referrals,
    completedReferrals,
    serviceDeliveries,
  ] = await Promise.all([
    transaction.child.count({ where: activeChildren }),
    transaction.child.count({
      where: {
        ...activeChildren,
        immunizations: {
          some: {
            status: { in: ['ACTIVE', 'AMENDED'] },
            administeredAt: window,
          },
        },
      },
    }),
    transaction.child.count({
      where: {
        ...activeChildren,
        growthMeasurements: {
          some: {
            status: { in: ['ACTIVE', 'AMENDED'] },
            vitaminAAdministered: true,
            measuredAt: window,
          },
        },
      },
    }),
    transaction.worklistEntry.count({
      where: {
        organizationId,
        eligibility: 'ELIGIBLE',
        createdAt: window,
      },
    }),
    transaction.worklistEntry.count({
      where: {
        organizationId,
        eligibility: 'ELIGIBLE',
        status: 'COMPLETED',
        createdAt: window,
      },
    }),
    transaction.referral.count({
      where: { organizationId, openedAt: window },
    }),
    transaction.referral.count({
      where: {
        organizationId,
        status: 'COMPLETED',
        openedAt: window,
      },
    }),
    transaction.serviceDelivery.count({
      where: { organizationId, deliveredAt: window },
    }),
  ]);

  return [
    {
      metricKey: 'registered_children',
      numerator: registeredChildren,
      denominator: null,
      valueBasisPoints: null,
      unit: 'COUNT',
      cohortSize: registeredChildren,
    },
    percentageMetric(
      'immunization_reach',
      immunizedChildren,
      registeredChildren
    ),
    percentageMetric('vitamin_a_reach', vitaminAChildren, registeredChildren),
    percentageMetric(
      'eligible_worklist_completion',
      completedEligibleEntries,
      eligibleEntries
    ),
    percentageMetric('referral_completion', completedReferrals, referrals),
    {
      metricKey: 'service_deliveries',
      numerator: serviceDeliveries,
      denominator: null,
      valueBasisPoints: null,
      unit: 'COUNT',
      cohortSize: serviceDeliveries,
    },
  ];
}

function disclosureFor(metric, policy) {
  if (!policy?.isPublicEnabled) {
    return { disclosureStatus: 'INTERNAL', suppressionReason: null };
  }
  if (metric.cohortSize < policy.minimumCellSize) {
    return {
      disclosureStatus: 'SUPPRESSED',
      suppressionReason: 'MINIMUM_CELL_SIZE',
    };
  }
  return { disclosureStatus: 'PUBLISHED', suppressionReason: null };
}

module.exports = {
  METRIC_CATALOG,
  calculateOrganizationMetrics,
  disclosureFor,
  percentageMetric,
};
