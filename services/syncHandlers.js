const { createClinicalService } = require('./clinicalService');
const { createClimateEventService } = require('./climateEventService');
const { createWorklistService } = require('./worklistService');
const { createReferralService } = require('./referralService');
const { requiredText } = require('./identityService');

function createSyncHandlers(prismaClient) {
  const clinical = createClinicalService(prismaClient);
  const climate = createClimateEventService(prismaClient);
  const worklists = createWorklistService(prismaClient);
  const referrals = createReferralService(prismaClient);

  return {
    'APPOINTMENT.SCHEDULE': (context, input) => clinical.scheduleAppointment(
      context,
      requiredText(input.childId, 'childId', 100),
      input
    ),
    'CLIMATE.PROFILE_UPSERT': (context, input) => climate.upsertClimateProfile(
      context,
      requiredText(input.childId, 'childId', 100),
      input
    ),
    'CLINICAL.GROWTH_RECORD': (context, input) => clinical.recordGrowth(
      context,
      requiredText(input.childId, 'childId', 100),
      input
    ),
    'CLINICAL.IMMUNIZATION_RECORD': (context, input) => clinical.recordImmunization(
      context,
      requiredText(input.childId, 'childId', 100),
      input
    ),
    'RESPONSE.DELIVERY_RECORD': (context, input) => worklists.recordDelivery(
      context,
      requiredText(input.entryId, 'entryId', 100),
      input
    ),
    'RESPONSE.REFERRAL_CREATE': (context, input) => referrals.createReferral(
      context,
      requiredText(input.entryId, 'entryId', 100),
      input
    ),
  };
}

module.exports = { createSyncHandlers };
