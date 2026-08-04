const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { prisma } = require('../utils/prisma');

router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, walletAddress, facilityName, facilityType, licenseNumber, specialization, professionalRole } = req.body;

    if (!firstName || !lastName || !email || !walletAddress) {
      return res.status(400).json({ error: 'First name, last name, email, and wallet address are required' });
    }

    const exists = await prisma.healthWorker.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (exists) {
      return res.status(409).json({ error: 'Health worker with this email already exists' });
    }

    const walletExists = await prisma.healthWorker.findFirst({ where: { walletAddress: { equals: walletAddress, mode: 'insensitive' } } });
    if (walletExists) {
      return res.status(409).json({ error: 'Health worker with this wallet address already exists' });
    }

    const newWorker = await prisma.healthWorker.create({
      data: {
        firstName,
        lastName,
        email,
        phone: phone || '',
        walletAddress,
        facilityName: facilityName || '',
        facilityType: facilityType || '',
        licenseNumber: licenseNumber || '',
        specialization: specialization || '',
        professionalRole: professionalRole || '',
        verificationStatus: 'pending',
        status: 'active',
      },
    });

    res.status(201).json({ message: 'Health worker registered successfully', healthWorker: newWorker });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/auth/wallet', async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const worker = await prisma.healthWorker.findFirst({ where: { walletAddress: { equals: walletAddress, mode: 'insensitive' } } });
    if (!worker) {
      return res.status(404).json({ error: 'Health worker not found with this wallet address' });
    }

    if (worker.status === 'inactive') {
      return res.status(403).json({ error: 'Account is inactive' });
    }

    res.json({
      message: 'Authentication successful',
      healthWorker: worker,
      token: `mock-session-token-${worker.id}-${Date.now()}`,
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/auth/verify', auth, (req, res) => {
  try {
    res.json({
      message: 'Session verified',
      healthWorker: req.healthWorker || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const healthWorkers = await prisma.healthWorker.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ healthWorkers, total: healthWorkers.length });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const worker = await prisma.healthWorker.findUnique({ where: { id: req.params.id } });
    if (!worker) {
      return res.status(404).json({ error: 'Health worker not found' });
    }
    res.json({ healthWorker: worker });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
