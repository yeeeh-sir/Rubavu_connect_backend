const { query, queryOne, execute, transaction } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

async function followUser(req, res, next) {
  try {
    const followerId = req.user.id;
    const followingId = parseInt(req.params.id, 10);

    if (followerId === followingId) {
      return sendError(res, 'You cannot follow yourself', null, 400);
    }

    const targetUser = await queryOne('SELECT id FROM users WHERE id = ? AND is_active = 1', [followingId]);
    if (!targetUser) {
      return sendError(res, 'User not found', null, 404);
    }

    const existing = await queryOne(
      'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
      [followerId, followingId]
    );
    if (existing) {
      return sendError(res, 'Already following this user', null, 409);
    }

    await query(
      'INSERT INTO follows (follower_id, following_id) VALUES (?, ?)',
      [followerId, followingId]
    );

    await query(
      `INSERT INTO notifications (user_id, from_user_id, type) VALUES (?, ?, 'follow')`,
      [followingId, followerId]
    );

    return sendSuccess(res, 'User followed', {}, 201);
  } catch (error) {
    next(error);
  }
}

async function unfollowUser(req, res, next) {
  try {
    const followerId = req.user.id;
    const followingId = parseInt(req.params.id, 10);

    const result = await execute(
      'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
      [followerId, followingId]
    );

    if (result.affectedRows === 0) {
      return sendError(res, 'Not following this user', null, 404);
    }

    return sendSuccess(res, 'User unfollowed');
  } catch (error) {
    next(error);
  }
}

async function getFollowers(req, res, next) {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;

    const user = await queryOne('SELECT id FROM users WHERE id = ? AND is_active = 1', [id]);
    if (!user) {
      return sendError(res, 'User not found', null, 404);
    }

    const countRows = await query('SELECT COUNT(*) as total FROM follows WHERE following_id = ?', [id]);
    const total = countRows[0]?.total || 0;

    const followers = await query(
      `SELECT u.id, u.username, u.full_name, u.profile_image_url, f.created_at as followed_at
       FROM follows f
       JOIN users u ON f.follower_id = u.id AND u.is_active = 1
       WHERE f.following_id = ?
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [id, String(limit), String(offset)]
    );

    return sendSuccess(res, 'Followers retrieved', {
      followers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

async function getFollowing(req, res, next) {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;

    const user = await queryOne('SELECT id FROM users WHERE id = ? AND is_active = 1', [id]);
    if (!user) {
      return sendError(res, 'User not found', null, 404);
    }

    const countRows = await query('SELECT COUNT(*) as total FROM follows WHERE follower_id = ?', [id]);
    const total = countRows[0]?.total || 0;

    const following = await query(
      `SELECT u.id, u.username, u.full_name, u.profile_image_url, f.created_at as followed_at
       FROM follows f
       JOIN users u ON f.following_id = u.id AND u.is_active = 1
       WHERE f.follower_id = ?
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [id, String(limit), String(offset)]
    );

    return sendSuccess(res, 'Following retrieved', {
      following,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { followUser, unfollowUser, getFollowers, getFollowing };
