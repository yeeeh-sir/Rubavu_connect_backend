const { query, queryOne } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

async function getNotifications(req, res, next) {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;

    const countRows = await query(
      'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?',
      [userId]
    );
    const total = countRows[0]?.total || 0;

    const notifications = await query(
      `SELECT n.*, u.username as from_username, u.full_name as from_full_name, u.profile_image_url as from_profile_image_url
       FROM notifications n
       JOIN users u ON n.from_user_id = u.id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, String(limit), String(offset)]
    );

    return sendSuccess(res, 'Notifications retrieved', {
      notifications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

async function markNotificationsRead(req, res, next) {
  try {
    const userId = req.user.id;
    await query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
    return sendSuccess(res, 'Notifications marked as read');
  } catch (error) {
    next(error);
  }
}

async function getUnreadCount(req, res, next) {
  try {
    const userId = req.user.id;
    const resultRows = await query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    return sendSuccess(res, 'Unread count retrieved', { count: resultRows[0]?.count || 0 });
  } catch (error) {
    next(error);
  }
}

module.exports = { getNotifications, markNotificationsRead, getUnreadCount };
