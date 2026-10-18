const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/adminAuth');
const { sensitiveLimiter } = require('../middleware/rateLimiter');
const adminStatsController = require('../controllers/adminStatsController');
const adminUserController = require('../controllers/adminUserController');
const adminContentController = require('../controllers/adminContentController');
const adminReportController = require('../controllers/adminReportController');
const adminAnalyticsController = require('../controllers/adminAnalyticsController');
const adminSettingsController = require('../controllers/adminSettingsController');
const adminSystemController = require('../controllers/adminSystemController');

router.use(authenticate);

router.get('/overview', requirePermission('dashboard.read'), adminStatsController.getOverview);

router.get('/users', requirePermission('users.read'), adminUserController.listUsers);
router.get('/users/:id', requirePermission('users.read'), adminUserController.getUserDetail);
router.patch(
  '/users/:id/status',
  sensitiveLimiter,
  requirePermission('users.write'),
  adminUserController.updateUserStatus
);
router.patch(
  '/users/:id/verify',
  sensitiveLimiter,
  requirePermission('users.write'),
  adminUserController.updateUserVerification
);
router.patch(
  '/users/:id/role',
  sensitiveLimiter,
  requirePermission('roles.write'),
  adminUserController.updateUserRole
);
router.patch(
  '/users/:id/email',
  sensitiveLimiter,
  requirePermission('users.write'),
  adminUserController.updateUserEmail
);
router.delete(
  '/users/:id',
  sensitiveLimiter,
  requirePermission('users.write'),
  adminUserController.deleteUser
);

router.get('/posts', requirePermission('content.read'), adminContentController.listPosts);
router.patch('/posts/:id/hide', requirePermission('content.write'), adminContentController.hidePost);
router.patch(
  '/posts/:id/restore',
  requirePermission('content.write'),
  adminContentController.restorePost
);
router.delete(
  '/posts/:id',
  sensitiveLimiter,
  requirePermission('content.write'),
  adminContentController.deletePost
);
router.get('/comments', requirePermission('content.read'), adminContentController.listComments);
router.delete(
  '/comments/:id',
  sensitiveLimiter,
  requirePermission('content.write'),
  adminContentController.deleteComment
);
router.get('/statuses', requirePermission('content.read'), adminContentController.listStatuses);
router.delete(
  '/statuses/:id',
  sensitiveLimiter,
  requirePermission('content.write'),
  adminContentController.deleteStatus
);
router.get('/media', requirePermission('content.read'), adminContentController.listMedia);

router.get('/reports', requirePermission('reports.read'), adminReportController.listReports);
router.get(
  '/reports/:type/:id',
  requirePermission('reports.read'),
  adminReportController.getReportDetail
);
router.patch(
  '/reports/:type/:id/status',
  requirePermission('reports.write'),
  adminReportController.updateReportStatus
);
router.post(
  '/reports/:type/:id/assign',
  requirePermission('reports.write'),
  adminReportController.assignReport
);
router.post(
  '/reports/:type/:id/notes',
  requirePermission('reports.write'),
  adminReportController.addReportNote
);

router.get('/analytics', requirePermission('analytics.read'), adminAnalyticsController.getAnalytics);
router.get(
  '/analytics/export',
  requirePermission('analytics.read'),
  adminAnalyticsController.exportAnalytics
);

router.get('/settings', requirePermission('settings.read'), adminSettingsController.getSettings);
router.put(
  '/settings',
  sensitiveLimiter,
  requirePermission('settings.write'),
  adminSettingsController.updateSettings
);

router.get('/audit', requirePermission('audit.read'), adminSystemController.getAuditLogs);
router.get('/roles', requirePermission('roles.write'), adminSystemController.getRoles);
router.get(
  '/notifications',
  requirePermission('notifications.read'),
  adminSystemController.getNotificationsOverview
);
router.get(
  '/connections',
  requirePermission('connections.read'),
  adminSystemController.getConnectionsOverview
);
router.delete(
  '/connections/:id',
  requirePermission('connections.write'),
  adminSystemController.removeConnection
);
router.get('/safety/blocks', requirePermission('safety.read'), adminSystemController.getBlocks);
router.delete(
  '/safety/blocks/:id',
  requirePermission('safety.write'),
  adminSystemController.removeBlock
);
router.get('/live', requirePermission('live.read'), adminSystemController.getLiveSessions);
router.post('/live/:id/end', requirePermission('live.write'), adminSystemController.endLiveSession);
router.get(
  '/messages/:userIdA/:userIdB',
  sensitiveLimiter,
  requirePermission('messages.read'),
  adminSystemController.getReportedConversation
);

module.exports = router;
