const { Router } = require('express');
const { auth } = require('../middleware/auth');
const { prisma } = require('../utils/prisma');

const router = Router();

// ─── Policy Endpoints ────────────────────────────────────────────────────────

// GET /policies — list all policies
router.get('/policies', auth, async (req, res) => {
  try {
    const policies = await prisma.insurancePolicy.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: policies, count: policies.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /policies — create a new policy
router.post('/policies', auth, async (req, res) => {
  try {
    const { policyNumber, provider, type, premium, frequency, startDate, endDate, coverage } = req.body;

    if (!policyNumber || !provider || !type || !premium || !frequency || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: policyNumber, provider, type, premium, frequency, startDate, endDate',
      });
    }

    const allowedTypes = ['health', 'dental', 'vision', 'supplemental'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid type. Must be one of: ${allowedTypes.join(', ')}`,
      });
    }

    const allowedFrequencies = ['monthly', 'quarterly', 'yearly'];
    if (!allowedFrequencies.includes(frequency)) {
      return res.status(400).json({
        success: false,
        message: `Invalid frequency. Must be one of: ${allowedFrequencies.join(', ')}`,
      });
    }

    const newPolicy = await prisma.insurancePolicy.create({
      data: {
        policyNumber,
        provider,
        type,
        status: 'active',
        startDate,
        endDate,
        premium: Number(premium),
        frequency,
        coverage: coverage || {},
        benefits: [],
        documents: [],
        nextPaymentDate: startDate,
      },
    });

    res.status(201).json({ success: true, data: newPolicy });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /policies/:id — get single policy
router.get('/policies/:id', auth, async (req, res) => {
  try {
    const policy = await prisma.insurancePolicy.findUnique({ where: { id: req.params.id } });
    if (!policy) {
      return res.status(404).json({ success: false, message: 'Policy not found' });
    }
    res.json({ success: true, data: policy });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Claim Endpoints ─────────────────────────────────────────────────────────

// GET /claims — list all claims
router.get('/claims', auth, async (req, res) => {
  try {
    const claims = await prisma.insuranceClaim.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: claims, count: claims.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /claims — submit a new claim
router.post('/claims', auth, async (req, res) => {
  try {
    const { policyId, patientName, serviceDate, provider, service, amount, notes } = req.body;

    if (!policyId || !patientName || !serviceDate || !provider || !service || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: policyId, patientName, serviceDate, provider, service, amount',
      });
    }

    const policy = await prisma.insurancePolicy.findUnique({ where: { id: policyId } });
    if (!policy) {
      return res.status(404).json({ success: false, message: 'Policy not found' });
    }

    if (policy.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Cannot file claim on an inactive policy' });
    }

    const claimCount = await prisma.insuranceClaim.count();
    const claimNumber = `CLM-${policy.type.toUpperCase()}-${new Date().getFullYear()}-${String(claimCount + 1).padStart(4, '0')}`;

    const newClaim = await prisma.insuranceClaim.create({
      data: {
        policyId,
        claimNumber,
        patientName,
        serviceDate,
        provider,
        service,
        amount: Number(amount),
        status: 'submitted',
        submissionDate: new Date().toISOString(),
        documents: [],
        notes: notes || '',
      },
    });

    res.status(201).json({ success: true, data: newClaim });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /claims/:id — get single claim
router.get('/claims/:id', auth, async (req, res) => {
  try {
    const claim = await prisma.insuranceClaim.findUnique({ where: { id: req.params.id } });
    if (!claim) {
      return res.status(404).json({ success: false, message: 'Claim not found' });
    }
    res.json({ success: true, data: claim });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Payment Endpoints ───────────────────────────────────────────────────────

// GET /payments — list payment history
router.get('/payments', auth, async (req, res) => {
  try {
    const paymentHistory = await prisma.insurancePayment.findMany({ orderBy: { paymentDate: 'desc' } });
    res.json({ success: true, data: paymentHistory, count: paymentHistory.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
