const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const postController = require('../controllers/postController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { uploadProfileImage, handleUploadError } = require('../middleware/upload');
const { profileUpdateValidation, searchValidation, paginationValidation } = require('../utils/validators');

router.get('/search', authenticate, searchValidation, paginationValidation, userController.searchUsers);
router.get('/:username', optionalAuth, userController.getProfile);
router.get('/:username/posts', optionalAuth, paginationValidation, postController.getUserPosts);
router.put('/profile', authenticate, profileUpdateValidation, userController.updateProfile);
router.post('/profile-image', authenticate, uploadProfileImage, handleUploadError, userController.uploadProfileImage);

module.exports = router;
