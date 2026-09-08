const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');

router.post('/posts/:id', authenticate, reportController.reportPost);
router.post('/comments/:id', authenticate, reportController.reportComment);
router.post('/live/:id', authenticate, reportController.reportLive);

module.exports = router;