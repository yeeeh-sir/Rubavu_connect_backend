const express = require('express');
const router = express.Router();
const statusController = require('../controllers/statusController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { uploadMedia, handleUploadError } = require('../middleware/upload');

router.post('/', authenticate, uploadMedia, handleUploadError, statusController.createStatus);
router.get('/', optionalAuth, statusController.getStatuses);
router.delete('/:id', authenticate, statusController.deleteStatus);

module.exports = router;
