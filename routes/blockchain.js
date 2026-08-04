const { Router } = require('express');
const blockchainController = require('../controllers/blockchain');
const { auth } = require('../middleware/auth');
const { createOrganizationAccessMiddleware } = require('../middleware/organizationAccess');

const router = Router();

const readAccess = createOrganizationAccessMiddleware({
  allowedRoles: ['AUDITOR', 'ADMIN', 'OWNER'],
});

router.get('/anchors', auth, readAccess, blockchainController.listAnchors);
router.get('/anchors/:anchorId', auth, readAccess, blockchainController.getAnchor);
router.get('/anchors/:anchorId/verify', auth, readAccess, blockchainController.verifyAnchor);
router.get('/blockchain/health', auth, readAccess, blockchainController.getBlockchainHealth);

module.exports = router;
