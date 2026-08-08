const { prisma } = require('../../utils/prisma');
const { networkFromRequest } = require('../../services/blockchain/networkRegistry');

const smartContractServices = new Map();
const escrowServices = new Map();

function getSmartContractService(network) {
  if (!smartContractServices.has(network)) {
    const SmartContractService = require('../../services/smartContractService');
    smartContractServices.set(network, new SmartContractService(network));
  }
  return smartContractServices.get(network);
}

function getEscrowService(network) {
  if (!escrowServices.has(network)) {
    const EscrowService = require('../../services/escrowService');
    escrowServices.set(network, new EscrowService(network));
  }
  return escrowServices.get(network);
}

function failure(res, error, fallback) {
  return res.status(error.status || 500).json({
    success: false,
    code: error.code || 'BLOCKCHAIN_OPERATION_FAILED',
    message: fallback,
    error: error.message,
  });
}

const prepareDonation = async (req, res) => {
  try {
    const network = networkFromRequest(req);
    const { campaignId, amount, donorWallet } = req.body;
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign || !campaign.appId) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found or not active',
      });
    }
    if (campaign.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'Campaign is not active',
      });
    }
    if (new Date() > campaign.endDate) {
      return res.status(400).json({
        success: false,
        message: 'Campaign has ended',
      });
    }

    const donation = await prisma.donation.create({
      data: {
        amount: parseFloat(amount),
        currency: 'ALGO',
        donorWallet,
        campaignId,
        status: 'PENDING',
      },
    });

    const { transactions, txId } = await getSmartContractService(network).donateToCampaign({
      appId: campaign.appId,
      donor: donorWallet,
      amount: parseFloat(amount),
    });
    const unsignedTransactionsBase64 = transactions.map((transaction) =>
      Buffer.from(transaction.toByte()).toString('base64')
    );

    return res.status(200).json({
      success: true,
      data: {
        donationId: donation.id,
        network,
        unsignedTransactions: unsignedTransactionsBase64,
        transactionHash: txId,
        campaign: {
          title: campaign.title,
          escrowAddress: campaign.escrowAddress,
        },
      },
      message: `Donation transactions prepared on ${network}`,
    });
  } catch (error) {
    return failure(res, error, 'Failed to prepare donation');
  }
};

const confirmDonation = async (req, res) => {
  try {
    const { donationId, signedTransaction, network: preparedNetwork } = req.body;
    const network = networkFromRequest(req, preparedNetwork);
    const txId = await getEscrowService(network).processDonation(
      donationId,
      signedTransaction
    );

    return res.status(200).json({
      success: true,
      data: {
        transactionHash: txId,
        network,
      },
      message: `Donation confirmed successfully on ${network}`,
    });
  } catch (error) {
    return failure(res, error, 'Failed to confirm donation');
  }
};

const getDonations = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const donations = await prisma.donation.findMany({
      where: { campaignId },
      include: {
        donor: {
          select: { name: true, wallet: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: donations,
    });
  } catch (error) {
    return failure(res, error, 'Failed to fetch donations');
  }
};

module.exports = {
  prepareDonation,
  confirmDonation,
  getDonations,
};
