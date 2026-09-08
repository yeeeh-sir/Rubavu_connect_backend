const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { registerValidation, loginValidation, googleAuthValidation } = require('../utils/validators');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/register', authLimiter, registerValidation, authController.register);
router.post('/login', authLimiter, loginValidation, authController.login);
router.post('/google', authLimiter, googleAuthValidation, authController.googleLogin);
router.get('/me', authenticate, authController.getMe);
router.post('/logout', authenticate, authController.logout);

module.exports = router;
