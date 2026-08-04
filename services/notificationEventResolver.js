const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');

function caregiverRecipient(caregiver) {
  if (!caregiver?.subjectId) return [];
  return [{ subjectId: caregiver.subjectId, caregiverId: caregiver.id }];
}

function primaryCaregiver(record) {
  return record?.child?.caregivers?.[0]?.caregiver || null;
}

function createNotificationEventResolver(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  function tenantRead(context, operation) {
    return withTenantTransaction(database, context.organizationId, operation);
  }

  async function rewardGranted(context, event) {
    const grant = await tenantRead(context, (transaction) => (
      transaction.rewardGrant.findFirst({
        where: { id: event.payload.rewardGrantId, organizationId: context.organizationId },
        include: {
          rewardCampaign: { select: { name: true } },
          rewardAccount: {
            include: { caregiver: { select: { id: true, subjectId: true } } },
          },
        },
      })
    ));
    if (!grant) return null;
    return {
      templateKey: 'REWARD_GRANTED',
      category: 'REWARDS',
      recipients: caregiverRecipient(grant.rewardAccount.caregiver),
      variables: {
        credits: grant.credits,
        campaignName: grant.rewardCampaign.name,
      },
    };
  }

  async function rewardRedeemed(context, event) {
    const redemption = await tenantRead(context, (transaction) => (
      transaction.rewardRedemption.findFirst({
        where: { id: event.payload.redemptionId, organizationId: context.organizationId },
        include: {
          merchant: { select: { name: true } },
          rewardReservation: {
            include: {
              rewardAccount: {
                include: { caregiver: { select: { id: true, subjectId: true } } },
              },
            },
          },
        },
      })
    ));
    if (!redemption) return null;
    return {
      templateKey: 'REWARD_REDEEMED',
      category: 'REWARDS',
      recipients: caregiverRecipient(redemption.rewardReservation.rewardAccount.caregiver),
      variables: {
        credits: redemption.amount,
        merchantName: redemption.merchant.name,
        category: redemption.rewardReservation.category,
      },
    };
  }

  async function settlementPaid(context, event) {
    const batch = await tenantRead(context, (transaction) => (
      transaction.settlementBatch.findFirst({
        where: {
          id: event.payload.settlementBatchId,
          organizationId: context.organizationId,
        },
        include: {
          merchant: {
            include: {
              memberships: {
                where: { status: 'ACTIVE', role: { in: ['OWNER', 'SETTLEMENT'] } },
                select: { subjectId: true },
              },
            },
          },
        },
      })
    ));
    if (!batch) return null;
    return {
      templateKey: 'SETTLEMENT_PAID',
      category: 'SETTLEMENT',
      recipients: batch.merchant.memberships,
      variables: {
        credits: batch.totalCredits,
        merchantName: batch.merchant.name,
      },
    };
  }

  async function appointment(context, event) {
    const record = await tenantRead(context, (transaction) => (
      transaction.appointment.findFirst({
        where: { id: event.payload.appointmentId, organizationId: context.organizationId },
        include: {
          facility: { select: { name: true } },
          child: {
            include: {
              caregivers: {
                where: { isPrimary: true },
                take: 1,
                include: { caregiver: { select: { id: true, subjectId: true } } },
              },
            },
          },
        },
      })
    ));
    if (!record) return null;
    const statusChanged = event.eventType === 'APPOINTMENT_STATUS_CHANGED';
    return {
      templateKey: statusChanged ? 'APPOINTMENT_STATUS_CHANGED' : 'APPOINTMENT_SCHEDULED',
      category: 'APPOINTMENTS',
      recipients: caregiverRecipient(primaryCaregiver(record)),
      variables: statusChanged
        ? {
          appointmentKind: record.kind,
          scheduledFor: record.scheduledFor.toISOString(),
          status: record.status,
        }
        : {
          appointmentKind: record.kind,
          scheduledFor: record.scheduledFor.toISOString(),
          facilityName: record.facility?.name || 'Medfinet care facility',
        },
    };
  }

  async function referral(context, event) {
    const record = await tenantRead(context, (transaction) => (
      transaction.referral.findFirst({
        where: { id: event.payload.referralId, organizationId: context.organizationId },
        include: {
          child: {
            include: {
              caregivers: {
                where: { isPrimary: true },
                take: 1,
                include: { caregiver: { select: { id: true, subjectId: true } } },
              },
            },
          },
        },
      })
    ));
    if (!record) return null;
    const statusChanged = event.eventType === 'REFERRAL_STATUS_CHANGED';
    return {
      templateKey: statusChanged ? 'REFERRAL_STATUS_CHANGED' : 'REFERRAL_OPENED',
      category: 'REFERRALS',
      recipients: caregiverRecipient(primaryCaregiver(record)),
      variables: statusChanged
        ? { referralType: record.referralType, status: record.status }
        : {
          referralType: record.referralType,
          destination: record.destination,
          priority: record.priority,
        },
    };
  }

  async function emergencyAccess(context, event) {
    const record = await tenantRead(context, (transaction) => (
      transaction.emergencyAccess.findFirst({
        where: {
          id: event.payload.emergencyAccessId,
          organizationId: context.organizationId,
        },
        include: {
          child: {
            include: {
              caregivers: {
                where: { isPrimary: true, hasConsentAuthority: true },
                take: 1,
                include: { caregiver: { select: { id: true, subjectId: true } } },
              },
            },
          },
        },
      })
    ));
    if (!record) return null;
    return {
      templateKey: 'EMERGENCY_ACCESS_ACTIVATED',
      category: 'SECURITY',
      recipients: caregiverRecipient(primaryCaregiver(record)),
      variables: {
        reasonCode: record.reasonCode,
        expiresAt: record.expiresAt.toISOString(),
      },
    };
  }

  async function vaccineDue(context, event) {
    const record = await tenantRead(context, (transaction) => (
      transaction.child.findFirst({
        where: {
          id: event.payload.childId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        include: {
          caregivers: {
            where: { isPrimary: true },
            take: 1,
            include: { caregiver: { select: { id: true, subjectId: true } } },
          },
          facility: { select: { name: true } },
        },
      })
    ));
    if (!record) return null;
    return {
      templateKey: 'VACCINE_DUE',
      category: 'VACCINATION',
      recipients: caregiverRecipient(primaryCaregiver(record)),
      variables: {
        childName: record.preferredName || record.legalName || 'your child',
        vaccineCode: record.vaccineCode || event.payload.vaccineCode,
        doseNumber: String(record.doseNumber || event.payload.doseNumber),
        dueAt: record.dueAt
          ? record.dueAt.toISOString()
          : event.payload.dueAt || 'soon',
        facilityName: record.facility?.name || 'Medfinet care facility',
      },
    };
  }

  async function resolve(context, event) {
    if (event.eventType === 'REWARD_GRANTED') return rewardGranted(context, event);
    if (event.eventType === 'REWARD_REDEEMED') return rewardRedeemed(context, event);
    if (event.eventType === 'SETTLEMENT_PAID') return settlementPaid(context, event);
    if (
      ['APPOINTMENT_SCHEDULED', 'APPOINTMENT_STATUS_CHANGED'].includes(event.eventType)
    ) {
      return appointment(context, event);
    }
    if (['REFERRAL_OPENED', 'REFERRAL_STATUS_CHANGED'].includes(event.eventType)) {
      return referral(context, event);
    }
    if (event.eventType === 'EMERGENCY_ACCESS_ACTIVATED') {
      return emergencyAccess(context, event);
    }
    if (event.eventType === 'VACCINE_DUE') {
      return vaccineDue(context, event);
    }
    throw new DomainError(
      400,
      'NOTIFICATION_EVENT_UNSUPPORTED',
      `Notification event ${event.eventType} is unsupported`
    );
  }

  return { resolve };
}

module.exports = {
  createNotificationEventResolver,
  caregiverRecipient,
  primaryCaregiver,
};
