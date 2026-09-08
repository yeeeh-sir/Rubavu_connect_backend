const { queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

async function targetUser(userId) {
  return queryOne('SELECT id FROM users WHERE id = ? AND is_active = 1', [userId]);
}

async function blockUser(req, res, next) {
  try {
    const blockedId = Number.parseInt(req.params.userId, 10);
    if (!Number.isInteger(blockedId) || blockedId < 1 || blockedId === req.user.id) return sendError(res, 'Invalid user to block', null, 400);
    if (!(await targetUser(blockedId))) return sendError(res, 'User not found', null, 404);
    await execute('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP', [req.user.id, blockedId]);
    await execute('DELETE FROM connections WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)', [req.user.id, blockedId, blockedId, req.user.id]);
    return sendSuccess(res, 'User blocked');
  } catch (error) { next(error); }
}

async function unblockUser(req, res, next) {
  try {
    const blockedId = Number.parseInt(req.params.userId, 10);
    const result = await execute('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, blockedId]);
    if (result.affectedRows === 0) return sendError(res, 'User is not blocked', null, 404);
    return sendSuccess(res, 'User unblocked');
  } catch (error) { next(error); }
}

async function reportUser(req, res, next) {
  try {
    const reportedId = Number.parseInt(req.params.userId, 10);
    const reason = String(req.body.reason || '').trim();
    if (!Number.isInteger(reportedId) || reportedId < 1 || reportedId === req.user.id) return sendError(res, 'Invalid user to report', null, 400);
    if (!reason || reason.length > 500) return sendError(res, 'A report reason under 500 characters is required', null, 400);
    if (!(await targetUser(reportedId))) return sendError(res, 'User not found', null, 404);
    await execute('INSERT INTO user_reports (reporter_id, reported_id, reason) VALUES (?, ?, ?)', [req.user.id, reportedId, reason]);
    return sendSuccess(res, 'Report submitted', null, 201);
  } catch (error) { next(error); }
}

async function getBlockStatus(req, res, next) {
  try {
    const userId = Number.parseInt(req.params.userId, 10);
    const block = await queryOne('SELECT id FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, userId]);
    const blockedBy = await queryOne('SELECT id FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [userId, req.user.id]);
    return sendSuccess(res, 'Block status retrieved', { is_blocked: Boolean(block), blocked_by_user: Boolean(blockedBy) });
  } catch (error) { next(error); }
}

module.exports = { blockUser, unblockUser, reportUser, getBlockStatus };
