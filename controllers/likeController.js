const { query, queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

async function likePost(req, res, next) {
  try {
    const userId = req.user.id;
    const postId = parseInt(req.params.id, 10);

    const post = await queryOne('SELECT id, user_id FROM posts WHERE id = ?', [postId]);
    if (!post) {
      return sendError(res, 'Post not found', null, 404);
    }

    const existing = await queryOne(
      'SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, userId]
    );
    if (existing) {
      return sendError(res, 'Already liked this post', null, 409);
    }

    await query(
      'INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)',
      [postId, userId]
    );

    if (post.user_id !== userId) {
      await query(
        `INSERT INTO notifications (user_id, from_user_id, type, post_id) VALUES (?, ?, 'like', ?)`,
        [post.user_id, userId, postId]
      );
    }

    const countRows = await query('SELECT COUNT(*) as count FROM post_likes WHERE post_id = ?', [postId]);

    return sendSuccess(res, 'Post liked', { likes_count: countRows[0]?.count || 0 }, 201);
  } catch (error) {
    next(error);
  }
}

async function unlikePost(req, res, next) {
  try {
    const userId = req.user.id;
    const postId = parseInt(req.params.id, 10);

    const result = await execute(
      'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, userId]
    );

    if (result.affectedRows === 0) {
      return sendError(res, 'Post not liked', null, 404);
    }

    const countRows = await query('SELECT COUNT(*) as count FROM post_likes WHERE post_id = ?', [postId]);

    return sendSuccess(res, 'Post unliked', { likes_count: countRows[0]?.count || 0 });
  } catch (error) {
    next(error);
  }
}

async function getPostLikes(req, res, next) {
  try {
    const postId = parseInt(req.params.id, 10);
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;

    const countRows = await query('SELECT COUNT(*) as total FROM post_likes WHERE post_id = ?', [postId]);
    const total = countRows[0]?.total || 0;

    const likes = await query(
      `SELECT u.id, u.username, u.full_name, u.profile_image_url, pl.created_at as liked_at
       FROM post_likes pl
       JOIN users u ON pl.user_id = u.id AND u.is_active = 1
       WHERE pl.post_id = ?
       ORDER BY pl.created_at DESC
       LIMIT ? OFFSET ?`,
      [postId, String(limit), String(offset)]
    );

    return sendSuccess(res, 'Post likes retrieved', {
      likes,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { likePost, unlikePost, getPostLikes };
