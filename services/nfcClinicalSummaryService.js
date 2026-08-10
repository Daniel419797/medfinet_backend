const { recommendation } = require('./vaccineScheduleService');

const REQUIRED_CLINICAL_CONSENT_SCOPES = [
  'IDENTITY',
  'DEMOGRAPHICS',
  'IMMUNIZATION',
  'CLINICAL_ALERTS',
];

const REQUIRED_IMMUNIZATION_CONSENT_SCOPES = [
  'IDENTITY',
  'DEMOGRAPHICS',
  'IMMUNIZATION',
];

function consentSummary(
  grants,
  currentTime,
  requiredCategories = REQUIRED_CLINICAL_CONSENT_SCOPES
) {
  const active = grants.find((grant) => (
    grant.status === 'ACTIVE'
    && grant.startsAt <= currentTime
    && (!grant.expiresAt || grant.expiresAt > currentTime)
    && requiredCategories.every((requiredCategory) => (
      grant.scopes.some(({ category, access }) => (
        category === requiredCategory && (access === 'READ' || access === 'WRITE')
      ))
    ))
  ));
  return active
    ? { status: 'GRANTED', consentGrantId: active.id, expiresAt: active.expiresAt }
    : { status: 'NOT_RECORDED', consentGrantId: null, expiresAt: null };
}

function adminTestReadBypass(membership) {
  return String(process.env.admin || '').trim().toLowerCase() === 'test'
    && membership?.status === 'ACTIVE'
    && ['OWNER', 'ADMIN'].includes(membership.role);
}

async function recordDisclosure({
  transaction,
  organizationId,
  childId,
  actorSubjectId,
  purpose,
  requiredCategories,
  clinicalAccess,
  consent,
  testAdminBypass,
}) {
  await transaction.disclosureEvent.create({
    data: {
      organizationId,
      childId,
      actorSubjectId,
      recipientType: 'ORGANIZATION',
      recipientId: organizationId,
      purpose,
      requestedScopes: requiredCategories.map((category) => ({
        category,
        access: 'READ',
      })),
      decision: clinicalAccess === 'ALLOWED' ? 'ALLOWED' : 'DENIED',
      reasonCode: testAdminBypass
        ? 'ADMIN_TEST_BYPASS'
        : clinicalAccess === 'ALLOWED'
          ? 'ACTIVE_CONSENT'
          : 'NO_APPLICABLE_CONSENT',
      ...(consent.consentGrantId ? { consentGrantId: consent.consentGrantId } : {}),
    },
  });
}

function exposedConsent(consent, testAdminBypass) {
  return testAdminBypass && consent.status !== 'GRANTED'
    ? { ...consent, status: 'ADMIN_TEST_BYPASS' }
    : consent;
}

async function loadNfcImmunizationSummary(
  transaction,
  organizationId,
  child,
  currentTime,
  purpose = 'nfc-immunization-certificate-access',
  actorSubjectId = 'system'
) {
  const [immunizations, consents, membership] = await Promise.all([
    transaction.immunizationRecord.findMany({
      where: {
        organizationId,
        childId: child.id,
        status: { in: ['ACTIVE', 'AMENDED'] },
      },
      select: {
        id: true,
        vaccineCode: true,
        doseNumber: true,
        administeredAt: true,
        status: true,
      },
      orderBy: { administeredAt: 'desc' },
      take: 100,
    }),
    transaction.consentGrant.findMany({
      where: {
        organizationId,
        childId: child.id,
        status: 'ACTIVE',
        startsAt: { lte: currentTime },
        OR: [{ expiresAt: null }, { expiresAt: { gt: currentTime } }],
      },
      select: {
        id: true,
        status: true,
        startsAt: true,
        expiresAt: true,
        scopes: { select: { category: true, access: true } },
      },
      take: 50,
    }),
    transaction.organizationMembership.findUnique({
      where: {
        organizationId_subjectId: {
          organizationId,
          subjectId: actorSubjectId,
        },
      },
      select: { status: true, role: true },
    }),
  ]);

  const consent = consentSummary(
    consents,
    currentTime,
    REQUIRED_IMMUNIZATION_CONSENT_SCOPES
  );
  const testAdminBypass = adminTestReadBypass(membership);
  const clinicalAccess = consent.status === 'GRANTED' || testAdminBypass
    ? 'ALLOWED'
    : 'CONSENT_REQUIRED';

  await recordDisclosure({
    transaction,
    organizationId,
    childId: child.id,
    actorSubjectId,
    purpose,
    requiredCategories: REQUIRED_IMMUNIZATION_CONSENT_SCOPES,
    clinicalAccess,
    consent,
    testAdminBypass,
  });

  return {
    clinicalAccess,
    allergies: [],
    vaccination: {
      recommendations: [],
      dueCount: 0,
      overdueCount: 0,
      recordedDoses: clinicalAccess === 'ALLOWED' ? immunizations.length : 0,
      records: clinicalAccess === 'ALLOWED' ? immunizations : [],
    },
    consent: exposedConsent(consent, testAdminBypass),
  };
}

async function loadNfcClinicalSummary(
  transaction,
  organizationId,
  child,
  currentTime,
  purpose = 'nfc-card-resolution',
  actorSubjectId = 'system'
) {
  const [allergies, immunizations, rules, consents, membership] = await Promise.all([
    transaction.allergyRecord.findMany({
      where: { organizationId, childId: child.id, status: 'ACTIVE' },
      select: {
        id: true,
        substanceDisplay: true,
        reaction: true,
        severity: true,
        criticality: true,
      },
      orderBy: [{ criticality: 'desc' }, { severity: 'desc' }],
      take: 20,
    }),
    transaction.immunizationRecord.findMany({
      where: {
        organizationId,
        childId: child.id,
        status: { in: ['ACTIVE', 'AMENDED'] },
      },
      select: {
        id: true,
        vaccineCode: true,
        doseNumber: true,
        administeredAt: true,
      },
      orderBy: { administeredAt: 'desc' },
      take: 100,
    }),
    transaction.vaccineScheduleRule.findMany({
      where: { organizationId, programmeId: null, status: 'ACTIVE' },
      orderBy: [{ vaccineCode: 'asc' }, { doseNumber: 'asc' }, { version: 'desc' }],
    }),
    transaction.consentGrant.findMany({
      where: {
        organizationId,
        childId: child.id,
        status: 'ACTIVE',
        startsAt: { lte: currentTime },
        OR: [{ expiresAt: null }, { expiresAt: { gt: currentTime } }],
      },
      select: {
        id: true,
        status: true,
        startsAt: true,
        expiresAt: true,
        scopes: { select: { category: true, access: true } },
      },
      take: 50,
    }),
    transaction.organizationMembership.findUnique({
      where: {
        organizationId_subjectId: {
          organizationId,
          subjectId: actorSubjectId,
        },
      },
      select: { status: true, role: true },
    }),
  ]);
  const latestRules = new Map();
  for (const rule of rules) {
    const key = `${rule.vaccineCode}:${rule.doseNumber}`;
    if (!latestRules.has(key)) latestRules.set(key, rule);
  }
  const vaccineSchedule = [...latestRules.values()].map((rule) => (
    recommendation(rule, child.dateOfBirth, immunizations, currentTime)
  ));
  const consent = consentSummary(consents, currentTime);
  const testAdminBypass = adminTestReadBypass(membership);
  const clinicalAccess = consent.status === 'GRANTED' || testAdminBypass
    ? 'ALLOWED'
    : 'CONSENT_REQUIRED';

  await recordDisclosure({
    transaction,
    organizationId,
    childId: child.id,
    actorSubjectId,
    purpose,
    requiredCategories: REQUIRED_CLINICAL_CONSENT_SCOPES,
    clinicalAccess,
    consent,
    testAdminBypass,
  });

  return {
    clinicalAccess,
    allergies: clinicalAccess === 'ALLOWED' ? allergies : [],
    vaccination: {
      recommendations: clinicalAccess === 'ALLOWED' ? vaccineSchedule : [],
      dueCount: clinicalAccess === 'ALLOWED'
        ? vaccineSchedule.filter(({ status }) => status === 'DUE').length
        : 0,
      overdueCount: clinicalAccess === 'ALLOWED'
        ? vaccineSchedule.filter(({ status }) => status === 'OVERDUE').length
        : 0,
      recordedDoses: clinicalAccess === 'ALLOWED' ? immunizations.length : 0,
    },
    consent: exposedConsent(consent, testAdminBypass),
  };
}

module.exports = {
  loadNfcClinicalSummary,
  loadNfcImmunizationSummary,
  consentSummary,
};
