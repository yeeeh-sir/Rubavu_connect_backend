const express = require('express');
const router = express.Router();
const commentController = require('../controllers/commentController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { commentValidation, paginationValidation } = require('../utils/validators');
const { uploadMedia, handleUploadError } = require('../middleware/upload');

router.post('/:id/comments', authenticate, uploadMedia, handleUploadError, commentController.createComment);
router.get('/:id/comments', optionalAuth, paginationValidation, commentController.getComments);
router.delete('/:id', authenticate, commentController.deleteComment);

module.exports = router;
