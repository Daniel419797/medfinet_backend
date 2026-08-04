const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { withTenantTransaction } = require('../services/tenantContext');
const { createUssdIdentityService } = require('../services/ussdIdentityService');
const { createUssdCareWorkflowService } = require('../services/ussdCareWorkflowService');
const { createUssdHighRiskWorkflowService } = require('../services/ussdHighRiskWorkflowService');
const { createUssdFacilityService } = require('../services/ussdFacilityService');
const { createUssdContinuationService } = require('../services/ussdContinuationService');
const { createUssdOtpService } = require('../services/ussdOtpService');
const { createUssdEngine } = require('../services/ussdEngine');
const { defaultNotificationTemplates } = require('../services/notificationDefaults');
const RUN_ID = crypto.randomUUID();

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sessionContext(organizationId, caregiverId, name) {
  return { organizationId, caregiverId, sessionId: `integration-${RUN_ID}-${name}` };
}

async function main() {
  const database = new PrismaClient();
  const suffix = Date.now();
  const localPhone = `080${String(suffix).slice(-8)}`;
  const e164Phone = `+234${localPhone.slice(1)}`;
  const organization = await database.organization.create({
    data: { name: 'USSD Integration Clinic', slug: `ussd-integration-${suffix}` },
  });
  const otherOrganization = await database.organization.create({
    data: { name: 'Isolation Clinic', slug: `ussd-isolation-${suffix}` },
  });
  const actor = 'integration:administrator';
  const seeded = await withTenantTransaction(database, organization.id, async (transaction) => {
    const facility = await transaction.facility.create({ data: {
      organizationId: organization.id,
      name: 'Community Health Centre',
      code: 'CHC-1',
      administrativeArea: 'Ikeja',
      address: '12 Main Road',
      phone: '+2348000000000',
      openingHours: { weekdays: '08:00-17:00' },
      programmeCategories: ['VACCINATION', 'NUTRITION'],
    } });
    const temporaryFacility = await transaction.facility.create({ data: {
      organizationId: organization.id,
      name: 'Flood Response Clinic',
      code: 'FLOOD-1',
      administrativeArea: 'Ikeja',
      address: 'Relief Camp',
      phone: '+2348000000001',
      openingHours: { daily: '24 hours' },
      programmeCategories: ['CLIMATE_EMERGENCY'],
      isTemporary: true,
      temporaryUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    } });
    const programme = await transaction.programme.create({ data: {
      organizationId: organization.id, name: 'Child Health', code: 'CHILD-HEALTH',
    } });
    const caregiver = await transaction.caregiver.create({ data: {
      organizationId: organization.id,
      firstName: 'Integration',
      lastName: 'Caregiver',
      preferredLanguage: 'en',
      createdBySubjectId: actor,
    } });
    const child = await transaction.child.create({ data: {
      organizationId: organization.id,
      medfinetId: `MF-USSD-${suffix}`,
      firstName: 'Musa',
      lastName: 'Test',
      dateOfBirth: new Date('2021-01-01T00:00:00Z'),
      sex: 'MALE',
      createdBySubjectId: actor,
    } });
    await transaction.childCaregiver.create({ data: {
      organizationId: organization.id,
      childId: child.id,
      caregiverId: caregiver.id,
      relationship: 'GUARDIAN',
      isPrimary: true,
      hasConsentAuthority: true,
    } });
    const appointment = await transaction.appointment.create({ data: {
      organizationId: organization.id,
      childId: child.id,
      facilityId: facility.id,
      kind: 'Vaccination follow-up',
      scheduledFor: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      createdBySubjectId: actor,
    } });
    const credential = await transaction.childCredential.create({ data: {
      organizationId: organization.id,
      childId: child.id,
      tokenHash: digest(`credential-${suffix}`),
      kind: 'NFC',
      issuedBySubjectId: actor,
    } });
    await transaction.nfcCredentialBinding.create({ data: {
      organizationId: organization.id,
      credentialId: credential.id,
      publicId: `public_${digest(String(suffix)).slice(0, 17)}`,
      status: 'ACTIVE',
      uidHash: digest(`uid-${suffix}`),
      personalizationNonceHash: digest(`nonce-${suffix}`),
      provisioningExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      originalitySignatureHash: digest(`signature-${suffix}`),
      originalityVerifiedAt: new Date(),
      writeProtectedAt: new Date(),
      configurationLockedAt: new Date(),
      activatedAt: new Date(),
      activatedBySubjectId: actor,
    } });
    const climateEvent = await transaction.climateEvent.create({ data: {
      organizationId: organization.id,
      name: 'Integration Flood Alert',
      eventType: 'FLOOD',
      status: 'ACTIVE',
      severity: 'HIGH',
      source: 'integration-test',
      externalReference: `flood-${suffix}`,
      startsAt: new Date(Date.now() - 60_000),
      activatedAt: new Date(),
      createdBySubjectId: actor,
    } });
    await transaction.affectedArea.create({ data: {
      organizationId: organization.id,
      climateEventId: climateEvent.id,
      administrativeAreaCode: 'Ikeja',
      administrativeAreaName: 'Ikeja',
      severity: 'HIGH',
      affectedFrom: new Date(Date.now() - 60_000),
      createdBySubjectId: actor,
    } });
    await transaction.climateProfile.create({ data: {
      organizationId: organization.id,
      childId: child.id,
      administrativeAreaCode: 'Ikeja',
      vulnerability: 'HIGH',
      assessedAt: new Date(),
      assessedBySubjectId: actor,
    } });
    const worklist = await transaction.beneficiaryWorklist.create({ data: {
      organizationId: organization.id,
      climateEventId: climateEvent.id,
      programmeId: programme.id,
      name: 'Integration Worklist',
      status: 'ACTIVE',
      authorizationBasis: 'Integration verification',
      criteria: { administrativeAreaCodes: ['Ikeja'] },
      generationComplete: true,
      generatedAt: new Date(),
      createdBySubjectId: actor,
      authorizedBySubjectId: actor,
      authorizedAt: new Date(),
    } });
    const entry = await transaction.worklistEntry.create({ data: {
      organizationId: organization.id,
      worklistId: worklist.id,
      childId: child.id,
      eligibility: 'ELIGIBLE',
      eligibilityReason: 'Integration verification',
      priority: 'HIGH',
      status: 'SERVED',
      completedAt: new Date(),
    } });
    const delivery = await transaction.serviceDelivery.create({ data: {
      organizationId: organization.id,
      worklistEntryId: entry.id,
      childId: child.id,
      category: 'MOSQUITO_NET',
      quantity: 1,
      unit: 'net',
      deliveredAt: new Date(),
      deliveredBySubjectId: actor,
      sourceOperationId: `delivery-${suffix}`,
    } });
    const account = await transaction.rewardAccount.create({ data: {
      organizationId: organization.id, caregiverId: caregiver.id, balance: 450n,
    } });
    const merchant = await transaction.merchant.create({ data: {
      organizationId: organization.id,
      name: 'Health Benefits Shop',
      code: 'HEALTH-SHOP',
      status: 'ACTIVE',
      eligibleCategories: ['NUTRITION', 'MOSQUITO_NET'],
      approvedBySubjectId: actor,
      approvedAt: new Date(),
      createdBySubjectId: actor,
    } });
    const reservation = await transaction.rewardReservation.create({ data: {
      organizationId: organization.id,
      rewardAccountId: account.id,
      merchantId: merchant.id,
      category: 'NUTRITION',
      amount: 50n,
      tokenHash: digest(`reservation-${suffix}`),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      createdBySubjectId: actor,
    } });
    const consentRequest = await transaction.ussdConsentRequest.create({ data: {
      organizationId: organization.id,
      caregiverId: caregiver.id,
      childId: child.id,
      recipientType: 'ORGANIZATION',
      recipientId: organization.id,
      recipientDisplayName: 'Community Health Centre',
      purpose: 'vaccination record review today',
      legalBasis: 'CAREGIVER_CONSENT',
      policyVersion: '1.0',
      requestedScopes: [{ category: 'IMMUNIZATION', access: 'READ' }],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdBySubjectId: actor,
    } });
    await transaction.notificationTemplate.createMany({
      data: defaultNotificationTemplates(organization.id, actor, new Date()),
      skipDuplicates: true,
    });
    return {
      facility, temporaryFacility, programme, caregiver, child, appointment,
      credential, climateEvent, delivery, account, merchant, reservation, consentRequest,
    };
  });

  const security = {
    phonePepper: 'p'.repeat(40), pinPepper: 'i'.repeat(40), otpPepper: 'o'.repeat(40),
    webhookSecret: 'w'.repeat(40), sessionTtlSeconds: 180, otpTtlSeconds: 300,
    maxResponseCharacters: 160, stateEncryptionKey: () => Buffer.alloc(32, 9),
  };
  const adminContext = { organizationId: organization.id, actorSubjectId: actor, purpose: 'USSD integration verification' };
  const identity = createUssdIdentityService(database, { config: security });
  await identity.setupAccess(adminContext, seeded.caregiver.id, { phone: localPhone, pin: '2468' });
  const care = createUssdCareWorkflowService(database);
  const highRisk = createUssdHighRiskWorkflowService(database);
  const facilityService = createUssdFacilityService(database);
  const continuation = createUssdContinuationService(database);

  await facilityService.publish(adminContext, seeded.facility.id);
  await facilityService.publish(adminContext, seeded.temporaryFacility.id);
  const directory = await facilityService.search('Ikeja');
  const temporary = await facilityService.search('Ikeja', { temporaryOnly: true });

  const appointment = await care.nextAppointment(
    sessionContext(organization.id, seeded.caregiver.id, 'appointment-read')
  );
  await care.respondToAppointment(
    sessionContext(organization.id, seeded.caregiver.id, 'appointment-confirm'),
    seeded.appointment.id,
    { decision: 'CONFIRMED' }
  );
  const vaccination = await care.nextAppointment(
    sessionContext(organization.id, seeded.caregiver.id, 'vaccination-read'),
    { vaccinationOnly: true }
  );
  await care.requestCallback(
    sessionContext(organization.id, seeded.caregiver.id, 'vaccination-callback'),
    'VACCINATION', seeded.child.id
  );
  await care.requestCallback(
    sessionContext(organization.id, seeded.caregiver.id, 'nutrition-callback'),
    'NUTRITION', seeded.child.id
  );

  const deliveredCodes = new Map();
  const otp = createUssdOtpService(database, {
    config: security,
    deliver: async ({ code, purpose }) => deliveredCodes.set(purpose, code),
  });
  async function verifyHighRisk(ctx, purpose, action) {
    const issued = await otp.issue(ctx, purpose, action);
    await otp.verify(ctx, issued.challengeId, purpose, action, deliveredCodes.get(purpose));
  }
  const cardContext = sessionContext(organization.id, seeded.caregiver.id, 'card');
  const cardAction = { type: 'CARD', id: seeded.credential.id, requestType: 'LOST_CARD_SUSPENSION' };
  await verifyHighRisk(cardContext, 'CARD_SUSPENSION', cardAction);
  await highRisk.requestCardSupport(cardContext, seeded.credential.id, 'LOST_CARD_SUSPENSION');

  const consentContext = sessionContext(organization.id, seeded.caregiver.id, 'consent');
  const consentAction = { type: 'CONSENT', id: seeded.consentRequest.id, decision: 'APPROVE' };
  await verifyHighRisk(consentContext, 'CONSENT_DECISION', consentAction);
  await highRisk.decideConsent(consentContext, seeded.consentRequest.id, 'APPROVE');

  await care.registerProgrammeInterest(
    sessionContext(organization.id, seeded.caregiver.id, 'programme'),
    { category: 'VACCINATION', programmeId: seeded.programme.id, childId: seeded.child.id }
  );
  await care.confirmDelivery(
    sessionContext(organization.id, seeded.caregiver.id, 'delivery'),
    seeded.delivery.id,
    'CONFIRMED'
  );
  const balance = await highRisk.rewardBalance(
    sessionContext(organization.id, seeded.caregiver.id, 'reward-balance')
  );
  const eligibleItems = await highRisk.eligibleRewardItems(
    sessionContext(organization.id, seeded.caregiver.id, 'reward-items')
  );
  const rewardContext = sessionContext(organization.id, seeded.caregiver.id, 'reward-confirm');
  const rewardAction = { type: 'REWARD', id: seeded.reservation.id, decision: 'CONFIRMED' };
  await verifyHighRisk(rewardContext, 'REWARD_REDEMPTION', rewardAction);
  await highRisk.confirmRewardReservation(rewardContext, seeded.reservation.id, 'CONFIRMED');
  const notice = await care.activeClimateNotice(
    sessionContext(organization.id, seeded.caregiver.id, 'climate-read'), 'Ikeja'
  );
  await care.requestClimateAssistance(
    sessionContext(organization.id, seeded.caregiver.id, 'climate-request'),
    { administrativeAreaCode: 'Ikeja', requestType: 'URGENT_NEED', climateEventId: seeded.climateEvent.id }
  );
  const sms = await continuation.queueFacilityDetails(
    sessionContext(organization.id, seeded.caregiver.id, 'facility-sms'),
    directory[0],
    'en'
  );

  const engine = createUssdEngine(database, {
    config: { ussd: security, notifications: {} },
    deliverOtp: async () => {},
  });
  const providerSessionId = `provider-${suffix}`;
  const initial = await engine.handle({
    sessionId: providerSessionId, serviceCode: '*123#', phoneNumber: e164Phone, text: '',
  });
  const root = await engine.handle({
    sessionId: providerSessionId, serviceCode: '*123#', phoneNumber: e164Phone, text: '2468',
  });
  const replay = await engine.handle({
    sessionId: providerSessionId, serviceCode: '*123#', phoneNumber: e164Phone, text: '2468',
  });

  const persisted = await withTenantTransaction(database, organization.id, async (transaction) => ({
    appointmentResponses: await transaction.appointmentCaregiverResponse.count(),
    callbacks: await transaction.ussdCallbackRequest.count(),
    cardRequests: await transaction.nfcCardSupportRequest.count(),
    consentGrants: await transaction.consentGrant.count(),
    programmeInterests: await transaction.programmeInterest.count(),
    deliveryConfirmations: await transaction.serviceDeliveryConfirmation.count(),
    rewardConfirmations: await transaction.rewardRedemptionConfirmation.count(),
    climateRequests: await transaction.climateAssistanceRequest.count(),
    smsMessages: await transaction.notificationMessage.count({ where: { category: 'USSD_CONTINUATION' } }),
    outboxEvents: await transaction.outboxEvent.count({ where: { eventType: 'NOTIFICATION_DISPATCH_REQUESTED' } }),
    suspendedCredentials: await transaction.childCredential.count({ where: { status: 'SUSPENDED' } }),
  }));
  const isolatedRows = await withTenantTransaction(database, otherOrganization.id, async (transaction) => (
    transaction.ussdCallbackRequest.count({ where: { organizationId: organization.id } })
  ));

  const assertions = {
    appointmentFound: appointment?.id === seeded.appointment.id,
    vaccinationFound: vaccination?.id === seeded.appointment.id,
    directoryFound: directory.length >= 2,
    temporaryFound: temporary[0]?.facilityName === 'Flood Response Clinic',
    rewardBalance: balance.balance === 450n,
    eligibleMerchant: eligibleItems[0]?.id === seeded.merchant.id,
    climateNotice: notice?.id === seeded.climateEvent.id,
    smsQueued: sms.channel === 'SMS',
    providerPinPrompt: initial.startsWith('CON Enter your'),
    providerRoot: root.startsWith('CON Medfinet'),
    providerReplay: replay === root,
    tenantIsolation: isolatedRows === 0,
    ...Object.fromEntries(Object.entries(persisted).map(([key, value]) => [key, value > 0])),
  };
  const failures = Object.entries(assertions).filter(([, passed]) => !passed).map(([name]) => name);
  if (failures.length) throw new Error(`USSD integration assertions failed: ${failures.join(', ')}`);
  process.stdout.write(`${JSON.stringify({ status: 'passed', assertions }, null, 2)}\n`);
  await database.$disconnect();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
