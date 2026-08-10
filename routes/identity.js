const { Router } = require('express');
const identityController = require('../controllers/identity');
const organizationController = require('../controllers/organization');
const { auth } = require('../middleware/auth');
const { createOrganizationAccessMiddleware } = require('../middleware/organizationAccess');
const clinicalController = require('../controllers/clinical');
const consentController = require('../controllers/consent');
const { createConsentAccessMiddleware } = require('../middleware/consentAccess');
const emergencyAccessController = require('../controllers/emergencyAccess');
const { stepUpAuth } = require('../middleware/stepUpAuth');
const climateController = require('../controllers/climate');
const worklistController = require('../controllers/worklist');
const offlineController = require('../controllers/offline');
const rewardRoutes = require('./rewards');
const notificationRoutes = require('./notifications');
const integrationRoutes = require('./integrations');
const analyticsRoutes = require('./analytics');
const governanceRoutes = require('./governance');
const localizationRoutes = require('./localization');
const vaccineScheduleController = require('../controllers/vaccineSchedule');
const nfcController = require('../controllers/nfc');
const { createRateLimitMiddleware } = require('../middleware/rateLimit');
const ussdController = require('../controllers/ussd');
const operationsController = require('../controllers/operations');
const aiController = require('../controllers/ai');
const { createCaregiverChildAccessMiddleware } = require('../middleware/caregiverChildAccess');
const {
  CLINICAL_READ_ROLES,
  CLINICAL_WRITE_ROLES,
} = require('../services/clinicalAccessPolicy');

const router = Router();
const readAccess = createOrganizationAccessMiddleware();
const childReadAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN', 'HEALTH_WORKER', 'NUTRITION_WORKER', 'EMERGENCY_COORDINATOR', 'CAREGIVER'],
});
const clinicalReadAccess = createOrganizationAccessMiddleware({
  allowedRoles: CLINICAL_READ_ROLES,
});
const appointmentReadAccess = createOrganizationAccessMiddleware({
  allowedRoles: [
    'OWNER', 'ADMIN', 'HEALTH_WORKER', 'NUTRITION_WORKER',
    'EMERGENCY_COORDINATOR', 'CAREGIVER',
  ],
});
const caregiverChildAccess = createCaregiverChildAccessMiddleware();
const emergencyWorkerAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['HEALTH_WORKER', 'EMERGENCY_COORDINATOR'],
});
const climateAdministrationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN', 'EMERGENCY_COORDINATOR'],
});
const responseWorkerAccess = createOrganizationAccessMiddleware({
  allowedRoles: [
    'OWNER',
    'ADMIN',
    'HEALTH_WORKER',
    'NUTRITION_WORKER',
    'EMERGENCY_COORDINATOR',
  ],
});
const fieldDeviceAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['HEALTH_WORKER', 'NUTRITION_WORKER', 'EMERGENCY_COORDINATOR'],
});
const identityWriteAccess = createOrganizationAccessMiddleware({
  allowedRoles: CLINICAL_WRITE_ROLES,
});
const administrationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN'],
});
const caregiverAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['CAREGIVER'],
});
const consentActionAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN', 'HEALTH_WORKER', 'CAREGIVER'],
});
const organizationLifecycleAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER'],
  allowedOrganizationStatuses: ['ACTIVE', 'SUSPENDED'],
});
const nfcLifecycleRateLimit = createRateLimitMiddleware({
  scope: 'nfc-lifecycle',
  limit: 10,
  windowMs: 60 * 1000,
  key: (req) => `${req.actorSubjectId}:${req.organization.id}`,
});
const nfcScanRateLimit = createRateLimitMiddleware({
  scope: 'nfc-scan',
  limit: 30,
  windowMs: 60 * 1000,
  key: (req) => req.user?.id || req.user?.sub || req.ip,
});
const certificateEvidenceRateLimit = createRateLimitMiddleware({
  scope: 'immunization-certificate-evidence',
  limit: 30,
  windowMs: 60 * 1000,
  key: (req) => `${req.actorSubjectId}:${req.organization.id}`,
});
const childIdentityDisclosure = createConsentAccessMiddleware({
  scopes: [
    { category: 'IDENTITY', access: 'READ' },
    { category: 'DEMOGRAPHICS', access: 'READ' },
    { category: 'CAREGIVER', access: 'READ' },
  ],
});
const clinicalTimelineDisclosure = createConsentAccessMiddleware({
  scopes: [
    { category: 'IMMUNIZATION', access: 'READ' },
    { category: 'NUTRITION', access: 'READ' },
    { category: 'CLINICAL_ALERTS', access: 'READ' },
    { category: 'APPOINTMENTS', access: 'READ' },
  ],
});
const immunizationCertificateDisclosure = createConsentAccessMiddleware({
  scopes: [
    { category: 'IDENTITY', access: 'READ' },
    { category: 'DEMOGRAPHICS', access: 'READ' },
    { category: 'IMMUNIZATION', access: 'READ' },
  ],
});
const climateProfileWriteDisclosure = createConsentAccessMiddleware({
  scopes: [{ category: 'CLIMATE', access: 'WRITE' }],
});

router.post('/organizations', auth, identityController.createOrganization);
router.get('/me/organizations', auth, organizationController.listMyOrganizations);
router.get('/organization-memberships', auth, administrationAccess, organizationController.listMemberships);
router.put('/organization-memberships', auth, administrationAccess, organizationController.upsertMembership);
router.put(
  '/organization-memberships/:membershipId/resource-scopes',
  auth,
  administrationAccess,
  stepUpAuth,
  organizationController.replaceMembershipScopes
);
router.patch(
  '/organization/status',
  auth,
  organizationLifecycleAccess,
  stepUpAuth,
  organizationController.changeOrganizationStatus
);
router.get('/facilities', auth, readAccess, organizationController.listFacilities);
router.post('/facilities', auth, administrationAccess, organizationController.createFacility);
router.patch(
  '/facilities/:facilityId',
  auth,
  administrationAccess,
  organizationController.updateFacility
);
router.get('/programmes', auth, readAccess, organizationController.listProgrammes);
router.post('/programmes', auth, administrationAccess, organizationController.createProgramme);
router.patch(
  '/programmes/:programmeId',
  auth,
  administrationAccess,
  organizationController.updateProgramme
);
router.post('/children', auth, identityWriteAccess, identityController.createChild);
router.get('/children', auth, childReadAccess, identityController.listChildren);
router.get('/children/search', auth, childReadAccess, identityController.searchChildren);
router.get('/me/caregiver', auth, caregiverAccess, identityController.getMyCaregiverProfile);
router.post(
  '/ai/ussd-intake',
  auth,
  readAccess,
  aiController.parseUssdIntake
);
router.get('/children/:id', auth, childReadAccess, caregiverChildAccess, childIdentityDisclosure, identityController.getChild);
router.post(
  '/children/:id/ai/assistant',
  auth,
  childReadAccess,
  caregiverChildAccess,
  aiController.askAssistant
);
router.get(
  '/children/:id/identity-amendments',
  auth,
  administrationAccess,
  identityController.listIdentityAmendments
);
router.post(
  '/children/:id/identity-amendments',
  auth,
  identityWriteAccess,
  identityController.requestIdentityAmendment
);
router.post(
  '/identity-amendments/:amendmentId/review',
  auth,
  administrationAccess,
  stepUpAuth,
  identityController.reviewIdentityAmendment
);
router.get(
  '/children/:id/identifiers',
  auth,
  childReadAccess,
  childIdentityDisclosure,
  identityController.listChildIdentifiers
);
router.post(
  '/children/:id/identifiers',
  auth,
  identityWriteAccess,
  identityController.createChildIdentifier
);
router.post(
  '/child-identifiers/:identifierId/verify',
  auth,
  administrationAccess,
  stepUpAuth,
  identityController.verifyChildIdentifier
);
router.post(
  '/child-identifiers/:identifierId/revoke',
  auth,
  administrationAccess,
  stepUpAuth,
  identityController.revokeChildIdentifier
);
router.post('/children/:id/caregivers', auth, identityWriteAccess, identityController.linkCaregiver);
router.post('/caregivers', auth, identityWriteAccess, identityController.createCaregiver);
router.get('/caregivers', auth, identityWriteAccess, operationsController.listCaregivers);
router.get('/appointments', auth, appointmentReadAccess, operationsController.listAppointments);
router.post(
  '/appointments/:appointmentId/caregiver-response',
  auth,
  caregiverAccess,
  operationsController.respondToAppointment
);
router.get('/emergency-access', auth, administrationAccess, operationsController.listEmergencyAccess);
router.get('/climate-events', auth, responseWorkerAccess, operationsController.listClimateEvents);
router.get('/worklists', auth, responseWorkerAccess, operationsController.listWorklists);
router.get('/worklists/:worklistId', auth, responseWorkerAccess, operationsController.getWorklist);
router.get('/devices', auth, administrationAccess, operationsController.listDevices);
router.get('/reward-accounts', auth, administrationAccess, operationsController.listRewardAccounts);
router.get('/reward-redemptions', auth, administrationAccess, operationsController.listRewardRedemptions);
router.put(
  '/caregivers/:caregiverId/ussd-access',
  auth,
  administrationAccess,
  stepUpAuth,
  ussdController.configureAccess
);
router.post(
  '/facilities/:facilityId/ussd-directory',
  auth,
  administrationAccess,
  ussdController.publishFacility
);
router.post(
  '/ussd/consent-requests',
  auth,
  identityWriteAccess,
  stepUpAuth,
  ussdController.createConsentRequest
);
router.get(
  '/ussd/queues/:type',
  auth,
  responseWorkerAccess,
  ussdController.listQueue
);
router.post(
  '/ussd/queues/:type/:id/review',
  auth,
  responseWorkerAccess,
  stepUpAuth,
  ussdController.reviewQueueItem
);
router.post('/children/:id/credentials', auth, identityWriteAccess, clinicalController.issueCredential);
router.post(
  '/children/:id/nfc-bindings',
  auth,
  administrationAccess,
  nfcLifecycleRateLimit,
  stepUpAuth,
  nfcController.createDraft
);
router.post(
  '/children/:id/nfc-bindings/tagwriter-demo',
  auth,
  administrationAccess,
  nfcLifecycleRateLimit,
  nfcController.createTagWriterDemo
);
router.get(
  '/children/:id/nfc-bindings',
  auth,
  administrationAccess,
  nfcController.listForChild
);
router.get(
  '/nfc/operations/summary',
  auth,
  administrationAccess,
  nfcController.operationsSummary
);
router.get(
  '/nfc-bindings/:bindingId',
  auth,
  administrationAccess,
  nfcController.getBinding
);
router.post(
  '/nfc-bindings/:bindingId/prepare',
  auth,
  administrationAccess,
  nfcLifecycleRateLimit,
  stepUpAuth,
  nfcController.prepare
);
router.post(
  '/nfc-bindings/:bindingId/activate',
  auth,
  administrationAccess,
  nfcLifecycleRateLimit,
  stepUpAuth,
  nfcController.activate
);
router.post(
  '/nfc-bindings/:bindingId/revoke',
  auth,
  administrationAccess,
  nfcLifecycleRateLimit,
  stepUpAuth,
  nfcController.revoke
);
router.post(
  '/nfc-bindings/:bindingId/replace',
  auth,
  administrationAccess,
  nfcLifecycleRateLimit,
  stepUpAuth,
  nfcController.replace
);
router.post(
  '/nfc-bindings/:bindingId/cancel',
  auth,
  administrationAccess,
  nfcLifecycleRateLimit,
  stepUpAuth,
  nfcController.cancel
);
router.post(
  '/credentials/bulk',
  auth,
  administrationAccess,
  stepUpAuth,
  clinicalController.issueCredentialsBulk
);
router.get('/credentials', auth, identityWriteAccess, clinicalController.listCredentials);
router.get(
  '/credentials/:credentialId',
  auth,
  identityWriteAccess,
  clinicalController.getCredential
);
router.post(
  '/credentials/resolve',
  auth,
  fieldDeviceAccess,
  clinicalController.resolveCredential
);
router.post(
  '/nfc/scans/challenges',
  auth,
  nfcScanRateLimit,
  nfcController.createChallenge
);
router.post(
  '/nfc/scans/resolve',
  auth,
  nfcScanRateLimit,
  nfcController.resolveScan
);
router.post('/credentials/:credentialId/revoke', auth, identityWriteAccess, clinicalController.revokeCredential);
router.post('/credentials/:credentialId/replace', auth, identityWriteAccess, clinicalController.replaceCredential);
router.post('/children/:id/immunizations', auth, identityWriteAccess, clinicalController.recordImmunization);
router.patch(
  '/immunizations/:immunizationId',
  auth,
  identityWriteAccess,
  clinicalController.amendImmunization
);
router.post('/children/:id/growth-measurements', auth, identityWriteAccess, clinicalController.recordGrowth);
router.patch(
  '/growth-measurements/:growthMeasurementId',
  auth,
  identityWriteAccess,
  clinicalController.amendGrowth
);
router.post('/children/:id/clinical-alerts', auth, identityWriteAccess, clinicalController.createAlert);
router.patch(
  '/clinical-alerts/:alertId/status',
  auth,
  identityWriteAccess,
  clinicalController.resolveAlert
);
router.post(
  '/children/:id/allergies',
  auth,
  identityWriteAccess,
  clinicalController.recordAllergy
);
router.patch(
  '/allergies/:allergyId/status',
  auth,
  identityWriteAccess,
  clinicalController.resolveAllergy
);
router.post('/children/:id/appointments', auth, identityWriteAccess, clinicalController.scheduleAppointment);
router.patch('/appointments/:appointmentId/status', auth, identityWriteAccess, clinicalController.updateAppointmentStatus);
router.get(
  '/vaccine-schedule-rules',
  auth,
  readAccess,
  vaccineScheduleController.listRules
);
router.post(
  '/vaccine-schedule-rules',
  auth,
  administrationAccess,
  vaccineScheduleController.createRule
);
router.post(
  '/vaccine-schedule-rules/:ruleId/activate',
  auth,
  administrationAccess,
  stepUpAuth,
  vaccineScheduleController.activateRule
);
router.get(
  '/children/:id/vaccine-schedule',
  auth,
  clinicalReadAccess,
  caregiverChildAccess,
  clinicalTimelineDisclosure,
  vaccineScheduleController.evaluate
);
router.get(
  '/children/:id/clinical-timeline',
  auth,
  clinicalReadAccess,
  caregiverChildAccess,
  clinicalTimelineDisclosure,
  clinicalController.getTimeline
);
router.get(
  '/children/:id/immunizations/:immunizationId/certificate',
  auth,
  clinicalReadAccess,
  caregiverChildAccess,
  immunizationCertificateDisclosure,
  clinicalController.downloadImmunizationCertificate,
);
router.get(
  '/children/:id/immunizations/:immunizationId/certificate/evidence',
  auth,
  clinicalReadAccess,
  caregiverChildAccess,
  immunizationCertificateDisclosure,
  certificateEvidenceRateLimit,
  clinicalController.getImmunizationCertificateEvidence,
);
router.post(
  '/children/:id/ai/timeline-summary',
  auth,
  clinicalReadAccess,
  caregiverChildAccess,
  aiController.summarizeTimeline
);
router.post(
  '/children/:id/ai/duplicates',
  auth,
  administrationAccess,
  aiController.detectDuplicates
);
router.post('/children/:id/consents', auth, identityWriteAccess, consentController.grant);
router.get(
  '/children/:id/consent-authorities',
  auth,
  identityWriteAccess,
  consentController.authorities
);
router.get(
  '/children/:id/consents',
  auth,
  childReadAccess,
  caregiverChildAccess,
  consentController.list
);
router.post(
  '/consents/:consentId/withdraw',
  auth,
  consentActionAccess,
  consentController.withdraw
);
router.post(
  '/children/:id/disclosures/evaluate',
  auth,
  childReadAccess,
  caregiverChildAccess,
  consentController.evaluate
);
router.post(
  '/children/:id/emergency-access',
  auth,
  emergencyWorkerAccess,
  stepUpAuth,
  emergencyAccessController.activate
);
router.get(
  '/children/:id/emergency-profile',
  auth,
  emergencyWorkerAccess,
  emergencyAccessController.profile
);
router.post(
  '/emergency-access/:accessId/review',
  auth,
  administrationAccess,
  emergencyAccessController.review
);
router.put(
  '/children/:id/climate-profile',
  auth,
  emergencyWorkerAccess,
  climateProfileWriteDisclosure,
  climateController.upsertProfile
);
router.post(
  '/climate-events',
  auth,
  climateAdministrationAccess,
  climateController.createEvent
);
router.post(
  '/climate-events/:eventId/affected-areas',
  auth,
  climateAdministrationAccess,
  climateController.addAffectedArea
);
router.patch(
  '/climate-events/:eventId/status',
  auth,
  climateAdministrationAccess,
  climateController.transitionEvent
);
router.post(
  '/climate-events/:eventId/worklists',
  auth,
  climateAdministrationAccess,
  worklistController.create
);
router.post(
  '/worklists/:worklistId/generate',
  auth,
  climateAdministrationAccess,
  worklistController.generate
);
router.post(
  '/worklists/:worklistId/authorize',
  auth,
  climateAdministrationAccess,
  worklistController.authorize
);
router.post(
  '/worklist-entries/:entryId/deliveries',
  auth,
  responseWorkerAccess,
  worklistController.deliver
);
router.post(
  '/worklist-entries/:entryId/referrals',
  auth,
  responseWorkerAccess,
  worklistController.createReferral
);
router.patch(
  '/referrals/:referralId/status',
  auth,
  responseWorkerAccess,
  worklistController.transitionReferral
);
router.post(
  '/devices',
  auth,
  fieldDeviceAccess,
  offlineController.registerDevice
);
router.post(
  '/devices/:deviceId/revoke',
  auth,
  fieldDeviceAccess,
  offlineController.revokeDevice
);
router.post(
  '/devices/:deviceId/nfc-provisioning-capability',
  auth,
  administrationAccess,
  stepUpAuth,
  offlineController.setNfcProvisioningCapability
);
router.post(
  '/devices/:deviceId/sync-batches',
  auth,
  fieldDeviceAccess,
  offlineController.submitBatch
);
router.get(
  '/sync-batches',
  auth,
  fieldDeviceAccess,
  offlineController.listBatches
);
router.get(
  '/sync-batches/:batchId',
  auth,
  fieldDeviceAccess,
  offlineController.getBatch
);
router.use(rewardRoutes);
router.use(notificationRoutes);
router.use(integrationRoutes);
router.use(analyticsRoutes);
router.use(governanceRoutes);
router.use(localizationRoutes);

module.exports = router;
