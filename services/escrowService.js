const SmartContractService = require('./smartContractService');
const AlgorandService = require('./algorandService');
const { prisma } = require('../utils/prisma');

function transactionToBase64(transaction) {
  if (transaction instanceof Uint8Array) {
    return Buffer.from(transaction).toString('base64');
  }
  if (transaction && typeof transaction.toByte === 'function') {
    return Buffer.from(transaction.toByte()).toString('base64');
  }
  throw new Error('Unsupported unsigned transaction format');
}

function decodeSignedTransactions(signedTransaction) {
  const values = Array.isArray(signedTransaction)
    ? signedTransaction
    : [signedTransaction];

  if (!values.length || values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('Signed transaction payload is required');
  }

  return values.map((value) => new Uint8Array(Buffer.from(value, 'base64')));
}

class EscrowService {
  constructor(network) {
    this.smartContractService = new SmartContractService(network);
    this.algorandService = new AlgorandService(network);
    this.network = this.algorandService.network;
  }

  async initializeCampaignEscrow(campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { creator: true },
    });
    if (!campaign) throw new Error('Campaign not found');

    const result = await this.smartContractService.createCampaignEscrow({
      creator: campaign.creatorWallet,
      targetAmount: campaign.targetAmount,
      endTime: Math.floor(campaign.endDate.getTime() / 1000),
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        escrowAddress: result.escrowAddress,
        appId: result.appId,
        status: 'ACTIVE',
      },
    });

    return {
      escrowAddress: result.escrowAddress,
      appId: result.appId,
      network: this.network,
    };
  }

  async processDonation(donationId, signedTransaction) {
    const donation = await prisma.donation.findUnique({
      where: { id: donationId },
      include: { campaign: true },
    });
    if (!donation) throw new Error('Donation not found');

    try {
      const signedTransactions = decodeSignedTransactions(signedTransaction);
      const txId = await this.algorandService.sendSignedTransaction(signedTransactions);
      await this.algorandService.waitForConfirmation(txId);

      await prisma.$transaction([
        prisma.donation.update({
          where: { id: donationId },
          data: {
            status: 'CONFIRMED',
            confirmedAt: new Date(),
            transactionHash: txId,
          },
        }),
        prisma.campaign.update({
          where: { id: donation.campaignId },
          data: { raisedAmount: { increment: donation.amount } },
        }),
      ]);

      return txId;
    } catch (error) {
      await prisma.donation.update({
        where: { id: donationId },
        data: { status: 'FAILED' },
      });
      throw new Error(`Donation processing failed on ${this.network}: ${error.message || error}`);
    }
  }

  async processPayout(campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { creator: true },
    });
    if (!campaign || !campaign.appId) {
      throw new Error('Campaign or app ID not found');
    }
    if (new Date() < campaign.endDate) {
      throw new Error('Campaign has not ended yet');
    }

    const { txId } = await this.smartContractService.withdrawFunds({
      appId: campaign.appId,
      creator: campaign.creatorWallet,
    });

    await prisma.escrowPayout.create({
      data: {
        campaignId,
        amount: campaign.raisedAmount,
        transactionHash: txId,
        status: 'PENDING',
      },
    });

    return txId;
  }

  async getEscrowBalance(escrowAddress) {
    return this.algorandService.getAccountBalance(escrowAddress);
  }

  async verifyCampaignCompletion(campaignId) {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || !campaign.appId) return false;
    const state = await this.smartContractService.getCampaignState(campaign.appId);
    const isActive = state.find((item) => item.key === 'campaign_active')?.value;
    return !isActive;
  }

  async processWithdrawal(campaignId, recipientWallet) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { creator: true },
    });
    if (!campaign || !campaign.appId) {
      throw new Error('Campaign or app ID not found');
    }
    if (campaign.status === 'WITHDRAWN') {
      throw new Error('Funds already withdrawn');
    }
    if (campaign.creatorWallet !== recipientWallet) {
      throw new Error('Connected wallet is not authorized to withdraw from this campaign');
    }

    const { transactions, txId } = await this.smartContractService.withdrawFunds({
      appId: campaign.appId,
      creator: campaign.creatorWallet,
    });
    const unsignedTransactions = transactions.map(transactionToBase64);

    const withdrawal = await prisma.campaignWithdrawal.create({
      data: {
        campaignId,
        amount: campaign.raisedAmount,
        recipientWallet: campaign.creatorWallet,
        transactionHash: txId,
        status: 'PENDING_SIGNATURE',
        unsignedTransaction: JSON.stringify(unsignedTransactions),
      },
    });

    return {
      withdrawalId: withdrawal.id,
      unsignedTransactions,
      transactionHash: txId,
      amount: campaign.raisedAmount,
      currency: campaign.currency,
      network: this.network,
    };
  }

  async completeWithdrawal(withdrawalId, signedTransaction) {
    const withdrawal = await prisma.campaignWithdrawal.findUnique({
      where: { id: withdrawalId },
      include: { campaign: true },
    });
    if (!withdrawal) throw new Error('Withdrawal record not found');

    try {
      const signedTransactions = decodeSignedTransactions(signedTransaction);
      const txId = await this.algorandService.sendSignedTransaction(signedTransactions);
      await this.algorandService.waitForConfirmation(txId);

      const completedAt = new Date();
      await prisma.$transaction([
        prisma.campaignWithdrawal.update({
          where: { id: withdrawalId },
          data: {
            status: 'COMPLETED',
            completedAt,
            transactionHash: txId,
          },
        }),
        prisma.campaign.update({
          where: { id: withdrawal.campaignId },
          data: {
            status: 'WITHDRAWN',
            withdrawnAmount: withdrawal.amount,
            withdrawnAt: completedAt,
          },
        }),
      ]);

      return {
        success: true,
        transactionHash: txId,
        amount: withdrawal.amount,
        completedAt,
        network: this.network,
      };
    } catch (error) {
      await prisma.campaignWithdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'FAILED' },
      });
      throw new Error(`Withdrawal completion failed on ${this.network}: ${error.message || error}`);
    }
  }

  async canWithdrawCampaign(campaignId) {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return { canWithdraw: false, reason: 'Campaign not found' };
    if (campaign.status === 'WITHDRAWN') {
      return { canWithdraw: false, reason: 'Funds already withdrawn' };
    }

    const hasEnded = new Date(campaign.endDate) <= new Date();
    const goalReached = campaign.raisedAmount >= campaign.targetAmount;
    const hasFunds = campaign.raisedAmount > 0;

    if (!hasEnded && !goalReached) {
      return {
        canWithdraw: false,
        reason: 'Campaign must be completed or ended to withdraw funds',
      };
    }
    if (!hasFunds) {
      return { canWithdraw: false, reason: 'No funds available for withdrawal' };
    }

    return {
      canWithdraw: true,
      creatorWallet: campaign.creatorWallet,
      network: this.network,
    };
  }

  async getWithdrawalStatus(withdrawalId) {
    return prisma.campaignWithdrawal.findUnique({
      where: { id: withdrawalId },
      include: { campaign: true },
    });
  }
}

module.exports = EscrowService;
