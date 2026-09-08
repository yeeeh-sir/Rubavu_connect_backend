const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');
const { paginationValidation } = require('../utils/validators');

router.get('/', authenticate, paginationValidation, notificationController.getNotifications);
router.get('/unread', authenticate, notificationController.getUnreadCount);
router.patch('/read', authenticate, notificationController.markNotificationsRead);

module.exports = router;
