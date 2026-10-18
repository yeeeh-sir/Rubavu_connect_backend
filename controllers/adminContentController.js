const { query, queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../services/auditService');

function parsePageLimit(req, defaultLimit = 20) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function listPosts(req, res, next) {
  try {
    const { page, limit, offset } = parsePageLimit(req);
    const filters = ['1=1'];
    const params = [];

    const q = String(req.query.q || '').trim();
    if (q) {
      filters.push('(p.caption LIKE ? OR u.username LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const author = String(req.query.author || '').trim();
    if (author) {
      filters.push('u.username = ?');
      params.push(author);
    }
    if (req.query.status === 'hidden') filters.push('p.is_hidden = 1');
    if (req.query.status === 'visible') filters.push('p.is_hidden = 0');
    if (req.query.status === 'reported') {
      filters.push("EXISTS (SELECT 1 FROM post_reports pr WHERE pr.post_id = p.id AND pr.status = 'open')");
    }
    if (['public', 'friends', 'private'].includes(req.query.audience)) {
      filters.push('p.audience = ?');
      params.push(req.query.audience);
    }
    if (validDate(req.query.from)) {
      filters.push('p.created_at >= ?');
      params.push(`${req.query.from} 00:00:00`);
    }
    if (validDate(req.query.to)) {
      filters.push('p.created_at <= ?');
      params.push(`${req.query.to} 23:59:59`);
    }

    const where = filters.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM posts p JOIN users u ON u.id = p.user_id WHERE ${where}`,
      params
    );

    const rows = await query(
      `SELECT p.id, p.user_id, u.username, u.full_name, u.profile_image_url,
         LEFT(COALESCE(p.caption, ''), 240) AS caption, p.media_type, p.audience,
         p.is_hidden, p.hidden_reason, p.hidden_at, p.created_at,
         (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS likes_count,
         (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
         (SELECT COUNT(*) FROM post_reports pr WHERE pr.post_id = p.id AND pr.status = 'open') AS open_reports,
         (SELECT COUNT(*) FROM post_reports WHERE post_id = p.id) AS total_reports
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendSuccess(res, 'Posts retrieved', {
      posts: rows,
      pagination: {
        page,
        limit,
        total: Number((countResult[0] || {}).total || 0),
        pages: Math.ceil(Number((countResult[0] || {}).total || 0) / limit),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function resolvePost(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    sendError(res, 'Invalid post id', null, 400);
    return null;
  }
  const post = await queryOne(
    'SELECT id, user_id, caption, is_hidden, audience FROM posts WHERE id = ?',
    [id]
  );
  if (!post) {
    sendError(res, 'Post not found', null, 404);
    return null;
  }
  return post;
}

async function hidePost(req, res, next) {
  try {
    const post = await resolvePost(req, res);
    if (!post) return;

    const reason = String(req.body.reason || '').trim();
    if (!reason || reason.length > 500) {
      return sendError(res, 'A reason is required (max 500 characters)', null, 400);
    }

    await execute(
      'UPDATE posts SET is_hidden = 1, hidden_reason = ?, hidden_by = ?, hidden_at = NOW() WHERE id = ?',
      [reason, req.user.id, post.id]
    );

    await logAudit(req, {
      action: 'post.hide',
      entityType: 'post',
      entityId: post.id,
      details: `reason: ${reason}${post.caption ? ` | caption: ${String(post.caption).slice(0, 120)}` : ''}`,
    });

    return sendSuccess(res, 'Post hidden');
  } catch (error) {
    next(error);
  }
}

async function restorePost(req, res, next) {
  try {
    const post = await resolvePost(req, res);
    if (!post) return;

    if (!post.is_hidden) {
      return sendError(res, 'Post is not hidden', null, 400);
    }

    await execute(
      'UPDATE posts SET is_hidden = 0, hidden_reason = NULL, hidden_by = NULL, hidden_at = NULL WHERE id = ?',
      [post.id]
    );

    await logAudit(req, {
      action: 'post.restore',
      entityType: 'post',
      entityId: post.id,
      details: 'Content restored to public visibility',
    });

    return sendSuccess(res, 'Post restored');
  } catch (error) {
    next(error);
  }
}

async function deletePost(req, res, next) {
  try {
    const post = await resolvePost(req, res);
    if (!post) return;

    const counts = await queryOne(
      `SELECT
         (SELECT COUNT(*) FROM comments WHERE post_id = ?) AS comments,
         (SELECT COUNT(*) FROM post_reports WHERE post_id = ?) AS reports`,
      [post.id, post.id]
    );

    await execute('DELETE FROM posts WHERE id = ?', [post.id]);

    await logAudit(req, {
      action: 'post.delete',
      entityType: 'post',
      entityId: post.id,
      details: `permanently deleted; comments removed: ${counts?.comments || 0}, reports removed: ${counts?.reports || 0}`,
    });

    return sendSuccess(res, 'Post permanently deleted');
  } catch (error) {
    next(error);
  }
}

async function listComments(req, res, next) {
  try {
    const { page, limit, offset } = parsePageLimit(req);
    const filters = ['1=1'];
    const params = [];

    const q = String(req.query.q || '').trim();
    if (q) {
      filters.push('(c.comment_text LIKE ? OR u.username LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (req.query.post_id) {
      const postId = parseInt(req.query.post_id, 10);
      if (Number.isInteger(postId) && postId > 0) {
        filters.push('c.post_id = ?');
        params.push(postId);
      }
    }
    if (req.query.status === 'reported') {
      filters.push("EXISTS (SELECT 1 FROM comment_reports cr WHERE cr.comment_id = c.id AND cr.status = 'open')");
    }
    if (validDate(req.query.from)) {
      filters.push('c.created_at >= ?');
      params.push(`${req.query.from} 00:00:00`);
    }
    if (validDate(req.query.to)) {
      filters.push('c.created_at <= ?');
      params.push(`${req.query.to} 23:59:59`);
    }

    const where = filters.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM comments c JOIN users u ON u.id = c.user_id WHERE ${where}`,
      params
    );

    const rows = await query(
      `SELECT c.id, c.post_id, c.user_id, u.username, u.full_name, u.profile_image_url,
         LEFT(COALESCE(c.comment_text, ''), 240) AS comment_text,
         c.media_type, c.created_at,
         LEFT(COALESCE(p.caption, ''), 160) AS post_caption, p.user_id AS post_owner_id,
         p.is_hidden AS post_is_hidden,
         (SELECT COUNT(*) FROM comment_reports cr WHERE cr.comment_id = c.id AND cr.status = 'open') AS open_reports,
         (SELECT COUNT(*) FROM comment_reports WHERE comment_id = c.id) AS total_reports
       FROM comments c
       JOIN users u ON u.id = c.user_id
       JOIN posts p ON p.id = c.post_id
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendSuccess(res, 'Comments retrieved', {
      comments: rows,
      pagination: {
        page,
        limit,
        total: Number((countResult[0] || {}).total || 0),
        pages: Math.ceil(Number((countResult[0] || {}).total || 0) / limit),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function deleteComment(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return sendError(res, 'Invalid comment id', null, 400);

    const comment = await queryOne(
      'SELECT id, post_id, user_id, comment_text FROM comments WHERE id = ?',
      [id]
    );
    if (!comment) return sendError(res, 'Comment not found', null, 404);

    const reports = await queryOne(
      'SELECT COUNT(*) AS total FROM comment_reports WHERE comment_id = ?',
      [id]
    );

    await execute('DELETE FROM comments WHERE id = ?', [id]);

    await logAudit(req, {
      action: 'comment.delete',
      entityType: 'comment',
      entityId: id,
      details: `post #${comment.post_id}; text: ${String(comment.comment_text || '').slice(0, 160)}`,
    });

    return sendSuccess(res, 'Comment permanently deleted', {
      reportsRemoved: Number(reports?.total || 0),
    });
  } catch (error) {
    next(error);
  }
}

async function listStatuses(req, res, next) {
  try {
    const { page, limit, offset } = parsePageLimit(req);
    const filters = ['1=1'];
    const params = [];

    if (req.query.expired === 'true') filters.push('s.expires_at < NOW()');
    if (req.query.expired === 'false') filters.push('s.expires_at >= NOW()');
    const q = String(req.query.q || '').trim();
    if (q) {
      filters.push('u.username LIKE ?');
      params.push(`%${q}%`);
    }

    const where = filters.join(' AND ');
    const countResult = await query(
      `SELECT COUNT(*) AS total FROM statuses s JOIN users u ON u.id = s.user_id WHERE ${where}`,
      params
    );

    const rows = await query(
      `SELECT s.id, s.user_id, u.username, u.full_name, u.profile_image_url,
         s.media_type, s.media_url, s.created_at, s.expires_at,
         (s.expires_at < NOW()) AS is_expired
       FROM statuses s
       JOIN users u ON u.id = s.user_id
       WHERE ${where}
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendSuccess(res, 'Statuses retrieved', {
      statuses: rows,
      pagination: {
        page,
        limit,
        total: Number((countResult[0] || {}).total || 0),
        pages: Math.ceil(Number((countResult[0] || {}).total || 0) / limit),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function deleteStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return sendError(res, 'Invalid status id', null, 400);

    const status = await queryOne(
      'SELECT id, user_id, media_type FROM statuses WHERE id = ?',
      [id]
    );
    if (!status) return sendError(res, 'Status not found', null, 404);

    await execute('DELETE FROM statuses WHERE id = ?', [id]);

    await logAudit(req, {
      action: 'status.delete',
      entityType: 'status',
      entityId: id,
      details: `owner user #${status.user_id}, type: ${status.media_type}`,
    });

    return sendSuccess(res, 'Status permanently deleted');
  } catch (error) {
    next(error);
  }
}

async function listMedia(req, res, next) {
  try {
    const { page, limit, offset } = parsePageLimit(req, 24);
    const source = ['posts', 'gallery', 'statuses'].includes(req.query.source)
      ? req.query.source
      : 'posts';

    const [postCount, galleryCount, statusCount] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total FROM posts p
         WHERE NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)`
      ),
      query('SELECT COUNT(*) AS total FROM post_media'),
      query('SELECT COUNT(*) AS total FROM statuses'),
    ]);

    const counts = {
      posts: Number((postCount[0] || {}).total || 0),
      gallery: Number((galleryCount[0] || {}).total || 0),
      statuses: Number((statusCount[0] || {}).total || 0),
    };

    let rows = [];
    let total = counts[source];

    if (source === 'posts') {
      rows = await query(
        `SELECT p.id, p.user_id, u.username, p.media_type, p.media_url, p.thumbnail_url,
           p.audience, p.is_hidden, p.created_at, 'post' AS kind
         FROM posts p
         JOIN users u ON u.id = p.user_id
         WHERE NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
         ORDER BY p.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    } else if (source === 'gallery') {
      rows = await query(
        `SELECT pm.id, pm.post_id AS parent_id, p.user_id, u.username, pm.media_type,
           pm.media_url, pm.thumbnail_url, pm.position, p.audience, p.is_hidden,
           pm.created_at, 'gallery' AS kind
         FROM post_media pm
         JOIN posts p ON p.id = pm.post_id
         JOIN users u ON u.id = p.user_id
         ORDER BY pm.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    } else {
      rows = await query(
        `SELECT s.id, s.user_id, u.username, s.media_type, s.media_url AS media_url,
           NULL AS thumbnail_url, s.created_at, s.expires_at,
           (s.expires_at < NOW()) AS is_expired, 'status' AS kind
         FROM statuses s
         JOIN users u ON u.id = s.user_id
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    }

    return sendSuccess(res, 'Media retrieved', {
      source,
      items: rows,
      counts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listPosts,
  hidePost,
  restorePost,
  deletePost,
  listComments,
  deleteComment,
  listStatuses,
  deleteStatus,
  listMedia,
};
