const express = require('express');
const router = express.Router();
const likeController = require('../controllers/likeController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { paginationValidation } = require('../utils/validators');

router.post('/:id/like', authenticate, likeController.likePost);
router.delete('/:id/like', authenticate, likeController.unlikePost);
router.get('/:id/likes', optionalAuth, paginationValidation, likeController.getPostLikes);

module.exports = router;
