// src/routes/campaign.routes.js
const { Router } = require('express');
const { createCampaign, getCampaigns, getCampaign } = require('../controllers/campaign/campaignController');
const { auth } = require('../middleware/auth');
const { prisma } = require('../utils/prisma');

const router = Router();

router.post('/', auth, createCampaign);
router.get('/', getCampaigns);

router.get('/health-packages', async (req, res) => {
  try {
    const packages = await prisma.healthPackage.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: packages, count: packages.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/:id', getCampaign);

module.exports = router;