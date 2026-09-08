const { query, queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const { MAX_VIDEO_DURATION } = require('../utils/video');

async function startLive(req, res, next) {
  try {
    const userId = req.user.id;
    const title = String(req.body.title || '').trim().slice(0, 120);
    const streamUrl = String(req.body.stream_url || '').trim().slice(0, 1000) || null;
    const viewerVisibility = ['public', 'connections'].includes(req.body.viewer_visibility)
      ? req.body.viewer_visibility
      : 'public';

    if (!title) {
      return sendError(res, 'Live title is required', null, 400);
    }

    const existingLive = await queryOne(
      'SELECT id FROM live_sessions WHERE creator_id = ? AND status = \'live\'',
      [userId]
    );
    if (existingLive) {
      return sendError(res, 'You already have an active live session', null, 409);
    }

    const result = await execute(
      'INSERT INTO live_sessions (creator_id, title, stream_url, status, viewer_visibility, created_by) VALUES (?, ?, ?, \'live\', ?, ?)',
      [userId, title, streamUrl, viewerVisibility, userId]
    );

    const session = await queryOne(
      `SELECT ls.*, u.username, u.full_name, u.profile_image_url
       FROM live_sessions ls JOIN users u ON ls.creator_id = u.id
       WHERE ls.id = ?`,
      [result.insertId]
    );

    const viewerCountRows = await query('SELECT COUNT(*) as count FROM live_viewers WHERE live_session_id = ? AND left_at IS NULL', [result.insertId]);
    session.viewer_count = viewerCountRows[0]?.count || 0;

    return sendSuccess(res, 'Live started', { live: session }, 201);
  } catch (error) {
    next(error);
  }
}

async function getActiveLives(req, res, next) {
  try {
    const userId = req.user ? req.user.id : null;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;

    let lives;
    if (userId) {
      lives = await query(
        `SELECT ls.*, u.username, u.full_name, u.profile_image_url,
          (SELECT COUNT(*) FROM live_viewers WHERE live_session_id = ls.id AND left_at IS NULL) as viewer_count,
          EXISTS (SELECT 1 FROM live_viewers lv WHERE lv.live_session_id = ls.id AND lv.user_id = ? AND lv.left_at IS NULL) as is_viewing
         FROM live_sessions ls
         JOIN users u ON ls.creator_id = u.id AND u.is_active = 1
         WHERE ls.status = 'live'
           AND (ls.viewer_visibility = 'public'
                OR ls.creator_id = ?
                OR EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted'
                  AND ((c.requester_id = ls.creator_id AND c.addressee_id = ?)
                    OR (c.requester_id = ? AND c.addressee_id = ls.creator_id))))
         ORDER BY ls.started_at DESC
         LIMIT ? OFFSET ?`,
        [String(userId), String(userId), String(userId), String(userId), String(limit), String(offset)]
      );
    } else {
      lives = await query(
        `SELECT ls.*, u.username, u.full_name, u.profile_image_url,
          (SELECT COUNT(*) FROM live_viewers WHERE live_session_id = ls.id AND left_at IS NULL) as viewer_count,
          0 as is_viewing
         FROM live_sessions ls
         JOIN users u ON ls.creator_id = u.id AND u.is_active = 1
         WHERE ls.status = 'live' AND ls.viewer_visibility = 'public'
         ORDER BY ls.started_at DESC
         LIMIT ? OFFSET ?`,
        [String(limit), String(offset)]
      );
    }

    return sendSuccess(res, 'Active lives retrieved', { lives });
  } catch (error) {
    next(error);
  }
}

async function joinLive(req, res, next) {
  try {
    const liveId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    const session = await queryOne('SELECT * FROM live_sessions WHERE id = ?', [liveId]);
    if (!session || session.status !== 'live') {
      return sendError(res, 'This live session is not active', null, 404);
    }

    await execute(
      `INSERT INTO live_viewers (live_session_id, user_id, joined_at, left_at)
       VALUES (?, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE left_at = NULL`,
      [liveId, userId]
    );

    const countRows = await query(
      'SELECT COUNT(*) as count FROM live_viewers WHERE live_session_id = ? AND left_at IS NULL',
      [liveId]
    );

    return sendSuccess(res, 'Joined live', { viewer_count: countRows[0]?.count || 0 });
  } catch (error) {
    next(error);
  }
}

async function leaveLive(req, res, next) {
  try {
    const liveId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    await execute(
      'UPDATE live_viewers SET left_at = NOW() WHERE live_session_id = ? AND user_id = ? AND left_at IS NULL',
      [liveId, userId]
    );

    const countRows = await query(
      'SELECT COUNT(*) as count FROM live_viewers WHERE live_session_id = ? AND left_at IS NULL',
      [liveId]
    );

    return sendSuccess(res, 'Left live', { viewer_count: countRows[0]?.count || 0 });
  } catch (error) {
    next(error);
  }
}

async function getLiveViewers(req, res, next) {
  try {
    const liveId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    const session = await queryOne('SELECT * FROM live_sessions WHERE id = ?', [liveId]);
    if (!session) return sendError(res, 'Live session not found', null, 404);

    const isCreator = session.creator_id === userId;
    const isConnected = await queryOne(
      `SELECT id FROM connections WHERE status = 'accepted'
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
      [userId, session.creator_id, session.creator_id, userId]
    );

    let viewers;
    if (isCreator) {
      viewers = await query(
        `SELECT lv.user_id, u.username, u.full_name, u.profile_image_url, lv.joined_at
         FROM live_viewers lv JOIN users u ON lv.user_id = u.id
         WHERE lv.live_session_id = ? AND lv.left_at IS NULL
         ORDER BY lv.joined_at ASC`,
        [liveId]
      );
    } else if (session.viewer_visibility === 'connections' && !isConnected) {
      viewers = [];
    } else {
      viewers = await query(
        `SELECT lv.user_id, u.username, u.full_name, u.profile_image_url
         FROM live_viewers lv JOIN users u ON lv.user_id = u.id
         WHERE lv.live_session_id = ? AND lv.left_at IS NULL
         ORDER BY lv.joined_at ASC`,
        [liveId]
      );
    }

    return sendSuccess(res, 'Live viewers retrieved', { viewers });
  } catch (error) {
    next(error);
  }
}

async function getLiveComments(req, res, next) {
  try {
    const liveId = parseInt(req.params.id, 10);
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = (page - 1) * limit;

    const session = await queryOne('SELECT id FROM live_sessions WHERE id = ?', [liveId]);
    if (!session) return sendError(res, 'Live session not found', null, 404);

    const comments = await query(
      `SELECT lc.*, u.username, u.full_name, u.profile_image_url
       FROM live_comments lc JOIN users u ON lc.user_id = u.id
       WHERE lc.live_session_id = ?
       ORDER BY lc.created_at ASC
       LIMIT ? OFFSET ?`,
      [liveId, String(limit), String(offset)]
    );

    return sendSuccess(res, 'Live comments retrieved', { comments });
  } catch (error) {
    next(error);
  }
}

async function postLiveComment(req, res, next) {
  try {
    const liveId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const commentText = String(req.body.comment_text || '').trim();

    if (!commentText) return sendError(res, 'Comment text is required', null, 400);
    if (commentText.length > 500) return sendError(res, 'Comment is too long', null, 400);

    const session = await queryOne('SELECT id FROM live_sessions WHERE id = ?', [liveId]);
    if (!session) return sendError(res, 'Live session not found', null, 404);

    const result = await execute(
      'INSERT INTO live_comments (live_session_id, user_id, comment_text) VALUES (?, ?, ?)',
      [liveId, userId, commentText]
    );

    const comment = await queryOne(
      `SELECT lc.*, u.username, u.full_name, u.profile_image_url
       FROM live_comments lc JOIN users u ON lc.user_id = u.id
       WHERE lc.id = ?`,
      [result.insertId]
    );

    return sendSuccess(res, 'Comment posted', { comment }, 201);
  } catch (error) {
    next(error);
  }
}

async function endLive(req, res, next) {
  try {
    const liveId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    const session = await queryOne('SELECT * FROM live_sessions WHERE id = ?', [liveId]);
    if (!session) return sendError(res, 'Live session not found', null, 404);
    if (session.creator_id !== userId) {
      return sendError(res, 'Only the live creator can end the session', null, 403);
    }

    await execute('UPDATE live_sessions SET status = \'ended\', ended_at = NOW() WHERE id = ?', [liveId]);
    await execute('UPDATE live_viewers SET left_at = NOW() WHERE live_session_id = ? AND left_at IS NULL', [liveId]);

    return sendSuccess(res, 'Live ended');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  startLive,
  getActiveLives,
  joinLive,
  leaveLive,
  getLiveViewers,
  getLiveComments,
  postLiveComment,
  endLive,
};