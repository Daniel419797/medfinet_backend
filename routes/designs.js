const { Router } = require('express');
const { auth } = require('../middleware/auth');
const { prisma } = require('../utils/prisma');

const router = Router();

const CATEGORIES = [
  'health-education',
  'vaccination-certificates',
  'community-outreach',
  'child-health',
];

const nextId = (prefix) => `${prefix}-${String(Date.now()).slice(-6)}`;

// ── Templates ──────────────────────────────────────────────

router.get('/templates', async (req, res) => {
  try {
    const { category } = req.query;
    const where = category ? { category } : {};
    const results = await prisma.designTemplate.findMany({ where });
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/templates/:id', async (req, res) => {
  try {
    const template = await prisma.designTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── Categories ─────────────────────────────────────────────

router.get('/categories', (_req, res) => {
  res.json({ success: true, data: CATEGORIES });
});

// ── User Designs ───────────────────────────────────────────

router.get('/user-designs', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.sub;
    const designs = await prisma.userDesign.findMany({
      where: { userId },
      orderBy: { lastModified: 'desc' },
    });
    res.json({ success: true, data: designs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/user-designs', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.sub;
    const { name, templateId, category, content } = req.body;

    if (!name || !templateId || !category || !content) {
      return res.status(400).json({ success: false, message: 'name, templateId, category, and content are required' });
    }

    const template = await prisma.designTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const design = await prisma.userDesign.create({
      data: {
        id: nextId('ud'),
        name,
        thumbnail: '',
        category,
        userId,
        templateId,
        content,
      },
    });

    res.status(201).json({ success: true, data: design });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.delete('/user-designs/:id', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.sub;

    const design = await prisma.userDesign.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!design) {
      return res.status(404).json({ success: false, message: 'Design not found' });
    }

    await prisma.userDesign.delete({ where: { id: design.id } });
    res.json({ success: true, message: 'Design deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── Certificates ───────────────────────────────────────────

router.post('/certificate', auth, async (req, res) => {
  try {
    const { childId, childName, vaccinations, templateId, content } = req.body;

    if (!childId || !childName || !vaccinations || !templateId || !content) {
      return res.status(400).json({
        success: false,
        message: 'childId, childName, vaccinations, templateId, and content are required',
      });
    }

    const template = await prisma.designTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const cert = await prisma.certificate.create({
      data: {
        id: nextId('cert'),
        childId,
        childName,
        vaccinations,
        templateId,
        content,
      },
    });

    res.status(201).json({ success: true, data: cert });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/certificate/:id/export', auth, async (req, res) => {
  try {
    const cert = await prisma.certificate.findUnique({ where: { id: req.params.id } });
    if (!cert) {
      return res.status(404).json({ success: false, message: 'Certificate not found' });
    }

    const format = 'pdf';
    const downloadUrl = `/downloads/certificates/${cert.id}.${format}`;

    res.json({ success: true, data: { format, downloadUrl } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
