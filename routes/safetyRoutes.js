const express = require('express');
const router = express.Router();
const safetyController = require('../controllers/safetyController');
const { authenticate } = require('../middleware/auth');

router.get('/status/:userId', authenticate, safetyController.getBlockStatus);
router.post('/:userId/block', authenticate, safetyController.blockUser);
router.delete('/:userId/block', authenticate, safetyController.unblockUser);
router.post('/:userId/report', authenticate, safetyController.reportUser);

module.exports = router;
