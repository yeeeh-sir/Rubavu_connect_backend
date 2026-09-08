const express = require('express');
const router = express.Router();
const connectionController = require('../controllers/connectionController');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, connectionController.listConnections);
router.get('/requests', authenticate, connectionController.listRequests);
router.get('/status/:userId', authenticate, connectionController.getStatus);
router.post('/requests/:userId', authenticate, connectionController.sendRequest);
router.patch('/requests/:requestId/accept', authenticate, connectionController.acceptRequest);
router.patch('/requests/:requestId/reject', authenticate, connectionController.rejectRequest);
router.delete('/requests/:requestId/cancel', authenticate, connectionController.cancelRequest);
router.delete('/:userId', authenticate, connectionController.removeConnection);

module.exports = router;
