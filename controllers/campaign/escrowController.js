const { prisma } = require('../../utils/prisma');
const { networkFromRequest } = require('../../services/blockchain/networkRegistry');

const escrowServices = new Map();

function getEscrowService(network) {
  if (!escrowServices.has(network)) {
    const EscrowService = require('../../services/escrowService');
    escrowServices.set(network, new EscrowService(network));
  }
  return escrowServices.get(network);
}

function failure(res, error, fallback, status = 400) {
  return res.status(error.status || status).json({
    success: false,
    code: error.code || 'BLOCKCHAIN_OPERATION_FAILED',
    message: error.message || fallback,
  });
}

const initiatePayout = async (req, res) => {
  try {
    const network = networkFromRequest(req);
    const { campaignId } = req.body;
    const txId = await getEscrowService(network).processPayout(campaignId);

    return res.status(200).json({
      success: true,
      data: { transactionHash: txId, network },
      message: `Payout initiated successfully on ${network}`,
    });
  } catch (error) {
    return failure(res, error, 'Failed to initiate payout', 500);
  }
};

const getEscrowBalance = async (req, res) => {
  try {
    const network = networkFromRequest(req);
    const { campaignId } = req.params;
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign || !campaign.escrowAddress) {
      return res.status(404).json({
        success: false,
        message: 'Campaign or escrow address not found',
      });
    }

    const balance = await getEscrowService(network).getEscrowBalance(
      campaign.escrowAddress
    );

    return res.status(200).json({
      success: true,
      data: {
        balance,
        escrowAddress: campaign.escrowAddress,
        network,
      },
    });
  } catch (error) {
    return failure(res, error, 'Failed to get escrow balance', 500);
  }
};

const initiateWithdrawal = async (req, res) => {
  try {
    const network = networkFromRequest(req);
    const { campaignId } = req.params;
    const { recipientWallet } = req.body;

    if (!recipientWallet) {
      return res.status(400).json({
        success: false,
        message: 'Recipient wallet is required',
      });
    }

    const result = await getEscrowService(network).processWithdrawal(
      campaignId,
      recipientWallet
    );

    return res.json({
      success: true,
      message: `Withdrawal initiated successfully on ${network}`,
      data: result,
    });
  } catch (error) {
    return failure(res, error, 'Failed to initiate withdrawal');
  }
};

const completeWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { signedTransaction, network: preparedNetwork } = req.body;
    const network = networkFromRequest(req, preparedNetwork);

    if (!signedTransaction) {
      return res.status(400).json({
        success: false,
        message: 'Signed transaction is required',
      });
    }

    const result = await getEscrowService(network).completeWithdrawal(
      withdrawalId,
      signedTransaction
    );

    return res.json({
      success: true,
      message: `Withdrawal completed successfully on ${network}`,
      data: result,
    });
  } catch (error) {
    return failure(res, error, 'Failed to complete withdrawal');
  }
};

const checkWithdrawalEligibility = async (req, res) => {
  try {
    const network = networkFromRequest(req);
    const { campaignId } = req.params;
    const result = await getEscrowService(network).canWithdrawCampaign(campaignId);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return failure(res, error, 'Failed to check withdrawal eligibility');
  }
};

const getWithdrawalStatus = async (req, res) => {
  try {
    const network = networkFromRequest(req);
    const { withdrawalId } = req.params;
    const withdrawal = await getEscrowService(network).getWithdrawalStatus(withdrawalId);

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found',
      });
    }

    return res.json({
      success: true,
      data: { ...withdrawal, network },
    });
  } catch (error) {
    return failure(res, error, 'Failed to get withdrawal status');
  }
};

module.exports = {
  initiatePayout,
  getEscrowBalance,
  initiateWithdrawal,
  completeWithdrawal,
  checkWithdrawalEligibility,
  getWithdrawalStatus,
};
