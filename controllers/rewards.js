const { createRewardCampaignService } = require('../services/rewardCampaignService');
const { createRewardGrantService } = require('../services/rewardGrantService');
const { createMerchantService } = require('../services/merchantService');
const { createRewardReservationService } = require('../services/rewardReservationService');
const { createRewardRedemptionService } = require('../services/rewardRedemptionService');
const { createRewardReversalService } = require('../services/rewardReversalService');
const { createSettlementService } = require('../services/settlementService');
const { createRewardQueryService } = require('../services/rewardQueryService');

const campaignService = createRewardCampaignService();
const grantService = createRewardGrantService();
const merchantService = createMerchantService();
const reservationService = createRewardReservationService();
const redemptionService = createRewardRedemptionService();
const reversalService = createRewardReversalService();
const settlementService = createSettlementService();
const queryService = createRewardQueryService();

function context(req) {
  return {
    organizationId: req.organization.id,
    actorSubjectId: req.actorSubjectId,
    role: req.organization.membership.role,
    purpose: req.accessPurpose,
    requestId: req.requestId,
  };
}

function handle(operation, status = 200) {
  return async (req, res, next) => {
    try {
      return res.status(status).json({
        success: true,
        data: await operation(req),
      });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  listCampaigns: handle(
    (req) => queryService.listCampaigns(context(req), req.query)
  ),
  listMerchants: handle(
    (req) => queryService.listMerchants(context(req), req.query)
  ),
  listMyMerchants: handle(
    (req) => queryService.listMyMerchants(context(req))
  ),
  getAccount: handle(
    (req) => queryService.getAccount(context(req), req.params.accountId, req.query)
  ),
  getMyAccount: handle(
    (req) => queryService.getMyAccount(context(req), req.query)
  ),
  listSettlements: handle(
    (req) => queryService.listSettlements(context(req), req.query)
  ),
  listMerchantSettlements: handle(
    (req) => queryService.listSettlements(
      context(req),
      { ...req.query, merchantId: req.params.merchantId }
    )
  ),
  createCampaign: handle(
    (req) => campaignService.createCampaign(context(req), req.body),
    201
  ),
  transitionCampaign: handle(
    (req) => campaignService.transitionCampaign(
      context(req),
      req.params.campaignId,
      req.body
    )
  ),
  grantMilestone: handle(
    (req) => grantService.grantMilestone(
      context(req),
      req.params.campaignId,
      req.params.childId,
      req.body
    ),
    201
  ),
  createMerchant: handle(
    (req) => merchantService.createMerchant(context(req), req.body),
    201
  ),
  approveMerchant: handle(
    (req) => merchantService.approveMerchant(
      context(req),
      req.params.merchantId,
      req.body
    )
  ),
  suspendMerchant: handle(
    (req) => merchantService.suspendMerchant(
      context(req),
      req.params.merchantId,
      req.body
    )
  ),
  upsertMerchantMember: handle(
    (req) => merchantService.upsertMerchantMember(
      context(req),
      req.params.merchantId,
      req.body
    )
  ),
  createReservation: handle(
    (req) => reservationService.createReservation(
      context(req),
      req.params.accountId,
      req.body.merchantId,
      req.body
    ),
    201
  ),
  redeem: handle(
    (req) => redemptionService.redeem(
      context(req),
      req.params.merchantId,
      req.body
    ),
    201
  ),
  releaseExpired: handle(
    (req) => reversalService.releaseExpired(
      context(req),
      req.params.reservationId
    )
  ),
  reverseRedemption: handle(
    (req) => reversalService.reverseRedemption(
      context(req),
      req.params.redemptionId,
      req.body
    )
  ),
  createSettlement: handle(
    (req) => settlementService.createBatch(
      context(req),
      req.params.merchantId,
      req.body
    ),
    201
  ),
  approveSettlement: handle(
    (req) => settlementService.approveBatch(
      context(req),
      req.params.settlementId
    )
  ),
  transitionSettlement: handle(
    (req) => settlementService.transitionBatch(
      context(req),
      req.params.settlementId,
      req.body
    )
  ),
};
