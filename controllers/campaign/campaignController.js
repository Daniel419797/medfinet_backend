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

const createCampaign = async (req, res) => {
  try {
    const network = networkFromRequest(req);
    const { title, description, targetAmount, category, endDate, impactGoal, imageUrl } = req.body;
    const supabaseUser = req.user;
    const id = supabaseUser.hospital_id.toString();
    let user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id,
          email: supabaseUser.admin_email,
          name: supabaseUser.hospital_name || supabaseUser.email,
          wallet: supabaseUser.wallet_address,
        },
      });
    }

    if (!user.wallet) {
      return res.status(400).json({
        success: false,
        message: 'Wallet not connected to your account. Please connect your Algorand wallet first.',
      });
    }

    const campaign = await prisma.campaign.create({
      data: {
        title,
        description,
        targetAmount: parseFloat(targetAmount),
        category,
        endDate: new Date(endDate),
        impactGoal,
        imageUrl,
        creatorId: user.id,
        creatorWallet: user.wallet,
        status: 'PENDING',
      },
    });

    const escrowResult = await getEscrowService(network).initializeCampaignEscrow(campaign.id);

    return res.status(201).json({
      success: true,
      data: {
        ...campaign,
        ...escrowResult,
        network,
      },
      message: `Campaign created successfully on ${network}`,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || 'CAMPAIGN_CREATION_FAILED',
      message: 'Failed to create campaign',
      error: error.message,
    });
  }
};

const getCampaigns = async (_req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        creator: {
          select: { name: true, wallet: true },
        },
        _count: {
          select: { donations: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: campaigns,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch campaigns',
      error: error.message,
    });
  }
};

const getCampaign = async (req, res) => {
  try {
    const network = networkFromRequest(req);
    const { id } = req.params;
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        creator: {
          select: { name: true, email: true, wallet: true },
        },
        donations: {
          include: {
            donor: {
              select: { name: true, wallet: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        updates: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    let escrowBalance = 0;
    if (campaign.escrowAddress) {
      escrowBalance = await getEscrowService(network).getEscrowBalance(
        campaign.escrowAddress
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        ...campaign,
        escrowBalance,
        network,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || 'CAMPAIGN_FETCH_FAILED',
      message: 'Failed to fetch campaign',
      error: error.message,
    });
  }
};

module.exports = {
  createCampaign,
  getCampaigns,
  getCampaign,
};
