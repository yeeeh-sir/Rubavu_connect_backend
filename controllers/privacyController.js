const { queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

async function getPrivacySettings(req, res, next) {
  try {
    const userId = req.user.id;
    const user = await queryOne(
      'SELECT id, who_can_message, who_can_connect, show_online FROM users WHERE id = ?',
      [userId]
    );
    if (!user) return sendError(res, 'User not found', null, 404);

    return sendSuccess(res, 'Privacy settings retrieved', {
      privacy: {
        who_can_message: user.who_can_message,
        who_can_connect: user.who_can_connect,
        show_online: !!user.show_online,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function updatePrivacySettings(req, res, next) {
  try {
    const userId = req.user.id;
    const { who_can_message, who_can_connect, show_online } = req.body;

    const updates = [];
    const params = [];

    if (['everyone', 'connections'].includes(who_can_message)) {
      updates.push('who_can_message = ?');
      params.push(who_can_message);
    }
    if (['everyone', 'connections'].includes(who_can_connect)) {
      updates.push('who_can_connect = ?');
      params.push(who_can_connect);
    }
    if (typeof show_online === 'boolean') {
      updates.push('show_online = ?');
      params.push(show_online ? 1 : 0);
    }

    if (updates.length === 0) {
      return sendError(res, 'No valid settings provided', null, 400);
    }

    params.push(userId);
    await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const user = await queryOne(
      'SELECT id, who_can_message, who_can_connect, show_online FROM users WHERE id = ?',
      [userId]
    );

    return sendSuccess(res, 'Privacy settings updated', {
      privacy: {
        who_can_message: user.who_can_message,
        who_can_connect: user.who_can_connect,
        show_online: !!user.show_online,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getPrivacySettings, updatePrivacySettings };