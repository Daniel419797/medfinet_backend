const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { prisma } = require('../utils/prisma');

router.post('/register', async (req, res) => {
  try {
    const { name, type, email, phone, website, establishedYear, bedCount, specialties, address, adminInfo, walletAddress } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const exists = await prisma.hospital.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (exists) {
      return res.status(409).json({ error: 'Hospital with this email already exists' });
    }

    const walletExists = await prisma.hospital.findFirst({ where: { walletAddress: { equals: walletAddress, mode: 'insensitive' } } });
    if (walletExists) {
      return res.status(409).json({ error: 'Hospital with this wallet address already exists' });
    }

    const newHospital = await prisma.hospital.create({
      data: {
        name,
        type: type || '',
        email,
        phone,
        website: website || '',
        establishedYear: establishedYear || null,
        bedCount: bedCount || 0,
        specialties: specialties || [],
        street: address?.street || '',
        city: address?.city || '',
        state: address?.state || '',
        zipCode: address?.zipCode || '',
        country: address?.country || 'Nigeria',
        adminName: adminInfo?.name || '',
        adminEmail: adminInfo?.email || '',
        adminPhone: adminInfo?.phone || '',
        adminTitle: adminInfo?.title || '',
        walletAddress,
        status: 'pending',
        verified: false,
      },
    });

    res.status(201).json({ message: 'Hospital registered successfully', hospital: newHospital });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const hospitals = await prisma.hospital.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ hospitals, total: hospitals.length });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const hospital = await prisma.hospital.findUnique({ where: { id: req.params.id } });
    if (!hospital) {
      return res.status(404).json({ error: 'Hospital not found' });
    }
    res.json({ hospital });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
