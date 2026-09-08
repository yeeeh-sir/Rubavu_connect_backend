const { query, queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

async function reportPost(req, res, next) {
  try {
    const reporterId = req.user.id;
    const postId = parseInt(req.params.id, 10);
    const reason = String(req.body.reason || '').trim();

    if (!Number.isInteger(postId) || postId < 1) return sendError(res, 'Invalid post', null, 400);
    if (!reason || reason.length > 500) return sendError(res, 'A reason is required (max 500 characters)', null, 400);

    const post = await queryOne('SELECT id FROM posts WHERE id = ?', [postId]);
    if (!post) return sendError(res, 'Post not found', null, 404);

    await execute(
      'INSERT INTO post_reports (reporter_id, post_id, reason) VALUES (?, ?, ?)',
      [reporterId, postId, reason]
    );

    return sendSuccess(res, 'Post reported', null, 201);
  } catch (error) {
    next(error);
  }
}

async function reportComment(req, res, next) {
  try {
    const reporterId = req.user.id;
    const commentId = parseInt(req.params.id, 10);
    const reason = String(req.body.reason || '').trim();

    if (!Number.isInteger(commentId) || commentId < 1) return sendError(res, 'Invalid comment', null, 400);
    if (!reason || reason.length > 500) return sendError(res, 'A reason is required (max 500 characters)', null, 400);

    const comment = await queryOne('SELECT id FROM comments WHERE id = ?', [commentId]);
    if (!comment) return sendError(res, 'Comment not found', null, 404);

    await execute(
      'INSERT INTO comment_reports (reporter_id, comment_id, reason) VALUES (?, ?, ?)',
      [reporterId, commentId, reason]
    );

    return sendSuccess(res, 'Comment reported', null, 201);
  } catch (error) {
    next(error);
  }
}

async function reportLive(req, res, next) {
  try {
    const reporterId = req.user.id;
    const liveSessionId = parseInt(req.params.id, 10);
    const reason = String(req.body.reason || '').trim();

    if (!Number.isInteger(liveSessionId) || liveSessionId < 1) return sendError(res, 'Invalid live session', null, 400);
    if (!reason || reason.length > 500) return sendError(res, 'A reason is required (max 500 characters)', null, 400);

    const session = await queryOne('SELECT id FROM live_sessions WHERE id = ?', [liveSessionId]);
    if (!session) return sendError(res, 'Live session not found', null, 404);

    await execute(
      'INSERT INTO live_reports (reporter_id, live_session_id, reason) VALUES (?, ?, ?)',
      [reporterId, liveSessionId, reason]
    );

    return sendSuccess(res, 'Live reported', null, 201);
  } catch (error) {
    next(error);
  }
}

module.exports = { reportPost, reportComment, reportLive };