const { Router } = require('express');
const rewardsController = require('../controllers/rewards');
const aiController = require('../controllers/ai');
const { auth } = require('../middleware/auth');
const {
  createOrganizationAccessMiddleware,
} = require('../middleware/organizationAccess');
const {
  createMerchantAccessMiddleware,
} = require('../middleware/merchantAccess');
const { stepUpAuth } = require('../middleware/stepUpAuth');

const router = Router();
const readAccess = createOrganizationAccessMiddleware();
const administrationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN'],
});
const rewardAccountAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN', 'CAREGIVER'],
});
const rewardGrantAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['OWNER', 'ADMIN', 'HEALTH_WORKER', 'NUTRITION_WORKER'],
});
const merchantOrganizationAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['MERCHANT'],
});
const merchantCashierAccess = createMerchantAccessMiddleware({
  allowedRoles: ['OWNER', 'CASHIER'],
});
const merchantSettlementAccess = createMerchantAccessMiddleware({
  allowedRoles: ['OWNER', 'SETTLEMENT'],
});

router.post('/reward-campaigns', auth, administrationAccess, rewardsController.createCampaign);
router.get('/reward-campaigns', auth, readAccess, rewardsController.listCampaigns);
router.patch(
  '/reward-campaigns/:campaignId/status',
  auth,
  administrationAccess,
  rewardsController.transitionCampaign
);
router.post(
  '/reward-campaigns/:campaignId/children/:childId/grants',
  auth,
  rewardGrantAccess,
  rewardsController.grantMilestone
);
router.post('/merchants', auth, administrationAccess, rewardsController.createMerchant);
router.get('/merchants', auth, readAccess, rewardsController.listMerchants);
router.get(
  '/me/merchants',
  auth,
  merchantOrganizationAccess,
  rewardsController.listMyMerchants
);
router.post(
  '/merchants/:merchantId/approve',
  auth,
  administrationAccess,
  stepUpAuth,
  rewardsController.approveMerchant
);
router.post(
  '/merchants/:merchantId/suspend',
  auth,
  administrationAccess,
  rewardsController.suspendMerchant
);
router.put(
  '/merchants/:merchantId/members',
  auth,
  administrationAccess,
  rewardsController.upsertMerchantMember
);
router.post(
  '/reward-accounts/:accountId/reservations',
  auth,
  rewardAccountAccess,
  rewardsController.createReservation
);
router.get(
  '/me/reward-account',
  auth,
  rewardAccountAccess,
  rewardsController.getMyAccount
);
router.get(
  '/reward-accounts/:accountId',
  auth,
  rewardAccountAccess,
  rewardsController.getAccount
);
router.post(
  '/merchants/:merchantId/redemptions',
  auth,
  merchantOrganizationAccess,
  merchantCashierAccess,
  rewardsController.redeem
);
router.post(
  '/reward-reservations/:reservationId/release-expired',
  auth,
  administrationAccess,
  rewardsController.releaseExpired
);
router.post(
  '/reward-redemptions/:redemptionId/reverse',
  auth,
  administrationAccess,
  stepUpAuth,
  rewardsController.reverseRedemption
);
router.post(
  '/merchants/:merchantId/settlements',
  auth,
  merchantOrganizationAccess,
  merchantSettlementAccess,
  rewardsController.createSettlement
);
router.get(
  '/merchants/:merchantId/settlements',
  auth,
  merchantOrganizationAccess,
  merchantSettlementAccess,
  rewardsController.listMerchantSettlements
);
router.post(
  '/settlements/:settlementId/approve',
  auth,
  administrationAccess,
  stepUpAuth,
  rewardsController.approveSettlement
);
router.get('/settlements', auth, administrationAccess, rewardsController.listSettlements);
router.get(
  '/reward-redemptions/ai-anomalies',
  auth,
  administrationAccess,
  aiController.detectRewardAnomalies
);
router.patch(
  '/settlements/:settlementId/status',
  auth,
  administrationAccess,
  stepUpAuth,
  rewardsController.transitionSettlement
);

module.exports = router;
