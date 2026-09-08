const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { authenticate } = require('../middleware/auth');
const { uploadMedia, handleUploadError } = require('../middleware/upload');
const { messageValidation, paginationValidation } = require('../utils/validators');
const { messageLimiter } = require('../middleware/rateLimiter');

router.get('/conversations', authenticate, messageController.getConversations);
router.get('/:userId', authenticate, paginationValidation, messageController.getMessages);
router.post('/', authenticate, messageLimiter, uploadMedia, handleUploadError, messageController.sendMessage);
router.patch('/:id/read', authenticate, messageController.markAsRead);

module.exports = router;
