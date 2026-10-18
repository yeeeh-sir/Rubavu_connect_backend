const { query, queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../services/auditService');
const { ROLES, canActOnUser, canAssignRole } = require('../utils/permissions');

const SORTS = {
  recent: 'u.created_at DESC',
  active: 'u.last_active_at DESC, u.created_at DESC',
  username: 'u.username ASC',
  posts: 'post_count DESC',
};

function parsePageLimit(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

async function listUsers(req, res, next) {
  try {
    const { page, limit, offset } = parsePageLimit(req);
    const filters = ['1=1'];
    const params = [];

    const q = String(req.query.q || '').trim();
    if (q) {
      filters.push('(u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (req.query.status === 'active') filters.push('u.is_active = 1');
    if (req.query.status === 'suspended') filters.push('u.is_active = 0');
    if (ROLES.includes(req.query.role)) {
      filters.push('u.role = ?');
      params.push(req.query.role);
    }
    if (req.query.verified === 'true') filters.push('u.is_verified = 1');
    if (req.query.verified === 'false') filters.push('u.is_verified = 0');

    const where = filters.join(' AND ');
    const order = SORTS[req.query.sort] || SORTS.recent;

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${where}`,
      params
    );

    const rows = await query(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.is_active, u.is_verified,
         u.created_at, u.last_active_at, u.profile_image_url,
         (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count,
         (SELECT COUNT(*) FROM connections c
           WHERE (c.requester_id = u.id OR c.addressee_id = u.id) AND c.status = 'accepted') AS connection_count,
         (SELECT COUNT(*) FROM user_reports ur WHERE ur.reported_id = u.id AND ur.status = 'open') AS open_reports
       FROM users u
       WHERE ${where}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendSuccess(res, 'Users retrieved', {
      users: rows,
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

async function getUserDetail(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return sendError(res, 'Invalid user id', null, 400);

    const user = await queryOne(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone_number, u.bio, u.interests,
         u.role, u.is_active, u.is_verified, u.created_at, u.updated_at, u.last_active_at,
         u.profile_image_url,
         (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count,
         (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comment_count,
         (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
         (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
         (SELECT COUNT(*) FROM connections c
           WHERE (c.requester_id = u.id OR c.addressee_id = u.id) AND c.status = 'accepted') AS connection_count,
         (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id OR m.receiver_id = u.id) AS message_count,
         (SELECT COUNT(*) FROM user_reports ur WHERE ur.reported_id = u.id AND ur.status = 'open') AS open_reports_against,
         (SELECT COUNT(*) FROM post_reports pr JOIN posts p ON p.id = pr.post_id
           WHERE p.user_id = u.id AND pr.status = 'open') AS open_reports_on_posts
       FROM users u
       WHERE u.id = ?`,
      [id]
    );
    if (!user) return sendError(res, 'User not found', null, 404);

    const [recentPosts, reportsAgainst, moderationHistory] = await Promise.all([
      query(
        `SELECT id, LEFT(COALESCE(caption, ''), 180) AS caption, media_type, audience,
           is_hidden, created_at
         FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
        [id]
      ),
      query(
        `SELECT ur.id, ur.reason, ur.status, ur.created_at, ru.username AS reporter_username
         FROM user_reports ur
         JOIN users ru ON ru.id = ur.reporter_id
         WHERE ur.reported_id = ?
         ORDER BY ur.created_at DESC LIMIT 5`,
        [id]
      ),
      query(
        `SELECT id, action, entity_type, entity_id, actor_username, details, created_at
         FROM admin_audit_logs
         WHERE entity_type = 'user' AND entity_id = ?
         ORDER BY id DESC LIMIT 10`,
        [id]
      ),
    ]);

    return sendSuccess(res, 'User detail retrieved', {
      user,
      recentPosts,
      reportsAgainst,
      moderationHistory,
    });
  } catch (error) {
    next(error);
  }
}

async function resolveTarget(req, res, options = {}) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    sendError(res, 'Invalid user id', null, 400);
    return null;
  }
  const target = await queryOne(
    'SELECT id, username, role, is_active, is_verified FROM users WHERE id = ?',
    [id]
  );
  if (!target) {
    sendError(res, 'User not found', null, 404);
    return null;
  }
  if (target.id === req.user.id) {
    sendError(res, 'You cannot perform this action on your own account', null, 400);
    return null;
  }
  if (!options.skipRankCheck && !canActOnUser(req.user.role, target.role)) {
    await logAudit(req, {
      action: 'auth.denied',
      entityType: 'user',
      entityId: target.id,
      details: `role '${req.user.role}' cannot manage '${target.role}' user #${target.id}`,
    });
    sendError(res, 'You do not have permission to manage this account', null, 403);
    return null;
  }
  return target;
}

async function updateUserStatus(req, res, next) {
  try {
    const target = await resolveTarget(req, res);
    if (!target) return;

    if (typeof req.body.is_active !== 'boolean') {
      return sendError(res, 'is_active must be a boolean', null, 400);
    }
    const isActive = req.body.is_active ? 1 : 0;
    const reason = req.body.reason ? String(req.body.reason).slice(0, 500) : null;

    await execute('UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?', [
      isActive,
      target.id,
    ]);

    await logAudit(req, {
      action: isActive ? 'user.reactivate' : 'user.suspend',
      entityType: 'user',
      entityId: target.id,
      details: `${target.username} (${target.role})${reason ? ` reason: ${reason}` : ''}`,
    });

    return sendSuccess(res, isActive ? 'Account reactivated' : 'Account suspended');
  } catch (error) {
    next(error);
  }
}

async function updateUserVerification(req, res, next) {
  try {
    const target = await resolveTarget(req, res);
    if (!target) return;

    if (typeof req.body.is_verified !== 'boolean') {
      return sendError(res, 'is_verified must be a boolean', null, 400);
    }
    const isVerified = req.body.is_verified ? 1 : 0;

    await execute('UPDATE users SET is_verified = ?, updated_at = NOW() WHERE id = ?', [
      isVerified,
      target.id,
    ]);

    await logAudit(req, {
      action: isVerified ? 'user.verify' : 'user.unverify',
      entityType: 'user',
      entityId: target.id,
      details: target.username,
    });

    return sendSuccess(res, isVerified ? 'Account verified' : 'Verification removed');
  } catch (error) {
    next(error);
  }
}

async function updateUserRole(req, res, next) {
  try {
    const target = await resolveTarget(req, res);
    if (!target) return;

    const newRole = String(req.body.role || '');
    if (!ROLES.includes(newRole)) {
      return sendError(res, 'Invalid role', null, 400);
    }

    if (!canAssignRole(req.user.role, target.role, newRole)) {
      await logAudit(req, {
        action: 'auth.denied',
        entityType: 'user',
        entityId: target.id,
        details: `role '${req.user.role}' may not assign '${newRole}' (target currently '${target.role}')`,
      });
      return sendError(res, 'You cannot grant this role', null, 403);
    }

    await execute('UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?', [
      newRole,
      target.id,
    ]);

    await logAudit(req, {
      action: 'user.role.change',
      entityType: 'user',
      entityId: target.id,
      details: `${target.username}: ${target.role} -> ${newRole}`,
    });

    return sendSuccess(res, 'Role updated', { role: newRole });
  } catch (error) {
    next(error);
  }
}

async function updateUserEmail(req, res, next) {
  try {
    const target = await resolveTarget(req, res);
    if (!target) return;

    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, 'Enter a valid email address', null, 400);
    }

    const existingEmail = await queryOne(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [email, target.id]
    );
    if (existingEmail) {
      return sendError(res, 'This email is already in use', null, 409);
    }

    await execute('UPDATE users SET email = ?, updated_at = NOW() WHERE id = ?', [
      email,
      target.id,
    ]);

    await logAudit(req, {
      action: 'user.email.change',
      entityType: 'user',
      entityId: target.id,
      details: `${target.username}: email -> ${email}`,
    });

    return sendSuccess(res, 'Email updated', { email });
  } catch (error) {
    next(error);
  }
}

async function deleteUser(req, res, next) {
  try {
    const target = await resolveTarget(req, res, { skipRankCheck: true });
    if (!target) return;

    const counts = await queryOne(
      `SELECT
         (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts,
         (SELECT COUNT(*) FROM comments WHERE user_id = ?) AS comments,
         (SELECT COUNT(*) FROM messages WHERE sender_id = ? OR receiver_id = ?) AS messages`,
      [target.id, target.id, target.id, target.id]
    );

    const result = await execute('DELETE FROM users WHERE id = ?', [target.id]);
    if (result.affectedRows !== 1) {
      return sendError(res, 'Account could not be deleted', null, 409);
    }

    await logAudit(req, {
      action: 'user.delete',
      entityType: 'user',
      entityId: target.id,
      details: `${target.username} (${target.role}) permanently deleted; posts: ${counts?.posts || 0}, comments: ${counts?.comments || 0}, messages: ${counts?.messages || 0}`,
    });

    return sendSuccess(res, 'Account permanently deleted');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listUsers,
  getUserDetail,
  updateUserStatus,
  updateUserVerification,
  updateUserRole,
  updateUserEmail,
  deleteUser,
};
