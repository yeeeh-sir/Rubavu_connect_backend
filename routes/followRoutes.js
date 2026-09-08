const express = require('express');
const router = express.Router();
const followController = require('../controllers/followController');
const { authenticate } = require('../middleware/auth');
const { paginationValidation } = require('../utils/validators');

router.post('/:id/follow', authenticate, followController.followUser);
router.delete('/:id/follow', authenticate, followController.unfollowUser);
router.get('/:id/followers', authenticate, paginationValidation, followController.getFollowers);
router.get('/:id/following', authenticate, paginationValidation, followController.getFollowing);

module.exports = router;
