const { createClinicalService } = require('../services/clinicalService');
const {
  createClinicalLifecycleService,
} = require('../services/clinicalLifecycleService');
const {
  createClinicalTimelineService,
} = require('../services/clinicalTimelineService');
const { createCredentialService } = require('../services/credentialService');
const { createCertificateService } = require('../services/certificateService');
const {
  createImmunizationAmendmentService,
} = require('../services/immunizationAmendmentService');

const service = createClinicalService();
const lifecycleService = createClinicalLifecycleService();
const timelineService = createClinicalTimelineService();
const credentialService = createCredentialService();
const certificateService = createCertificateService();
const immunizationAmendmentService = createImmunizationAmendmentService();

function authenticatedDisplayName(req) {
  const metadata = req.user?.user_metadata || {};
  if (typeof metadata.name === 'string' && metadata.name.trim()) {
    return metadata.name.trim();
  }
  if (typeof metadata.full_name === 'string' && metadata.full_name.trim()) {
    return metadata.full_name.trim();
  }
  return '';
}

const context = (req) => ({
  organizationId: req.organization.id,
  actorSubjectId: req.actorSubjectId,
  actorDisplayName: authenticatedDisplayName(req),
  role: req.organization.membership.role,
  membershipId: req.organization.membership.id,
  scopeMode: req.organization.membership.scopeMode,
  purpose: req.accessPurpose,
});
const handle = (operation, status = 200) => async (req, res, next) => {
  try { return res.status(status).json({ success: true, data: await operation(req) }); }
  catch (error) { return next(error); }
};

async function downloadImmunizationCertificate(req, res, next) {
  try {
    const certificate = await certificateService.create(
      context(req),
      req.params.id,
      req.params.immunizationId,
    );
    res.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `attachment; filename="${certificate.filename}"`,
      'Content-Length': String(certificate.buffer.length),
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.status(200).send(certificate.buffer);
  } catch (error) {
    return next(error);
  }
}

async function getImmunizationCertificateEvidence(req, res, next) {
  try {
    const evidence = await certificateService.evidence(
      context(req),
      req.params.id,
      req.params.immunizationId,
    );
    res.set('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json({ success: true, data: evidence });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  issueCredential: handle((req) => credentialService.issue(context(req), req.params.id, req.body), 201),
  issueCredentialsBulk: handle((req) => credentialService.issueBulk(context(req), req.body), 201),
  listCredentials: handle((req) => credentialService.list(context(req), req.query.childId, req.query)),
  getCredential: handle((req) => credentialService.get(context(req), req.params.credentialId)),
  resolveCredential: handle((req) => credentialService.resolve(context(req), req.body.token, req.body)),
  revokeCredential: handle((req) => credentialService.revoke(context(req), req.params.credentialId, req.body)),
  replaceCredential: handle((req) => credentialService.replace(context(req), req.params.credentialId, req.body), 201),
  recordImmunization: handle((req) => service.recordImmunization(context(req), req.params.id, req.body), 201),
  recordGrowth: handle((req) => service.recordGrowth(context(req), req.params.id, req.body), 201),
  createAlert: handle((req) => service.createAlert(context(req), req.params.id, req.body), 201),
  resolveAlert: handle(
    (req) => lifecycleService.resolveAlert(
      context(req),
      req.params.alertId,
      req.body
    )
  ),
  recordAllergy: handle(
    (req) => lifecycleService.recordAllergy(
      context(req),
      req.params.id,
      req.body
    ),
    201
  ),
  resolveAllergy: handle(
    (req) => lifecycleService.resolveAllergy(
      context(req),
      req.params.allergyId,
      req.body
    )
  ),
  amendImmunization: handle(
    (req) => immunizationAmendmentService.amend(
      context(req),
      req.params.immunizationId,
      req.body
    )
  ),
  amendGrowth: handle(
    (req) => lifecycleService.amendGrowth(
      context(req),
      req.params.growthMeasurementId,
      req.body
    )
  ),
  scheduleAppointment: handle((req) => service.scheduleAppointment(context(req), req.params.id, req.body), 201),
  updateAppointmentStatus: handle((req) => service.updateAppointmentStatus(context(req), req.params.appointmentId, req.body)),
  getTimeline: handle((req) => service.getClinicalTimeline(context(req), req.params.id)),
  getNutritionTimeline: handle((req) => timelineService.getNutrition(context(req), req.params.id)),
  downloadImmunizationCertificate,
  getImmunizationCertificateEvidence,
};
