const express = require('express');
const router = express.Router();
const privacyController = require('../controllers/privacyController');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, privacyController.getPrivacySettings);
router.put('/', authenticate, privacyController.updatePrivacySettings);

module.exports = router;