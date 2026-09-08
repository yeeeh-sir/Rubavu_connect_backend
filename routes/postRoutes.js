const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { uploadMultipleMedia, handleUploadError } = require('../middleware/upload');
const { postValidation, paginationValidation } = require('../utils/validators');

router.post('/', authenticate, uploadMultipleMedia, handleUploadError, postValidation, postController.createPost);
router.get('/', optionalAuth, paginationValidation, postController.getPosts);
router.get('/collaborations/pending', authenticate, postController.getPendingCollaborations);
router.get('/:id', optionalAuth, postController.getPostById);
router.patch('/:id/collaborators/status', authenticate, postController.updateCollaboratorStatus);
router.delete('/:id/collaborators/:userId', authenticate, postController.removeCollaborator);
router.delete('/:id', authenticate, postController.deletePost);

module.exports = router;