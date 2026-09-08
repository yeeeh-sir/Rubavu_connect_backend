const express = require('express');
const router = express.Router();
const liveController = require('../controllers/liveController');
const { authenticate, optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, liveController.getActiveLives);
router.get('/:id/comments', liveController.getLiveComments);
router.post('/', authenticate, liveController.startLive);
router.post('/:id/join', authenticate, liveController.joinLive);
router.post('/:id/leave', authenticate, liveController.leaveLive);
router.get('/:id/viewers', authenticate, liveController.getLiveViewers);
router.post('/:id/comments', authenticate, liveController.postLiveComment);
router.post('/:id/end', authenticate, liveController.endLive);

module.exports = router;