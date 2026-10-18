const { query, queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../services/auditService');
const {
  ROLES,
  STAFF_ROLES,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  getRoleRank,
} = require('../utils/permissions');

function parsePageLimit(req, defaultLimit = 20) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function getAuditLogs(req, res, next) {
  try {
    const { page, limit, offset } = parsePageLimit(req);
    const filters = ['1=1'];
    const params = [];

    const action = String(req.query.action || '').trim();
    if (action) {
      filters.push('action LIKE ?');
      params.push(`%${action}%`);
    }
    const actor = String(req.query.actor || '').trim();
    if (actor) {
      filters.push('actor_username LIKE ?');
      params.push(`%${actor}%`);
    }
    if (req.query.entity_type) {
      filters.push('entity_type = ?');
      params.push(String(req.query.entity_type));
    }
    if (validDate(req.query.from)) {
      filters.push('created_at >= ?');
      params.push(`${req.query.from} 00:00:00`);
    }
    if (validDate(req.query.to)) {
      filters.push('created_at <= ?');
      params.push(`${req.query.to} 23:59:59`);
    }

    const where = filters.join(' AND ');
    const countResult = await query(
      `SELECT COUNT(*) AS total FROM admin_audit_logs WHERE ${where}`,
      params
    );
    const rows = await query(
      `SELECT id, actor_id, actor_username, action, entity_type, entity_id, details, ip_address, created_at
       FROM admin_audit_logs
       WHERE ${where}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = Number((countResult[0] || {}).total || 0);
    return sendSuccess(res, 'Audit logs retrieved', {
      logs: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

async function getRoles(req, res, next) {
  try {
    const [counts, denials] = await Promise.all([
      query(
        `SELECT role, COUNT(*) AS count FROM users GROUP BY role`
      ),
      query(
        `SELECT COUNT(*) AS count FROM admin_audit_logs WHERE action = 'auth.denied'`
      ),
    ]);

    const countMap = {};
    for (const row of counts) countMap[row.role] = Number(row.count);

    const actorRank = getRoleRank(req.user.role);
    const roles = ROLES.map((role) => ({
      role,
      rank: getRoleRank(role),
      userCount: countMap[role] || 0,
      permissions: ROLE_PERMISSIONS[role] || [],
      assignableByActor:
        req.user.role === 'super_admin'
          ? true
          : getRoleRank(role) < actorRank,
    }));

    return sendSuccess(res, 'Roles retrieved', {
      roles,
      allPermissions: ALL_PERMISSIONS,
      staffRoles: STAFF_ROLES,
      deniedAttempts: Number((denials[0] || {}).count || 0),
    });
  } catch (error) {
    next(error);
  }
}

async function getNotificationsOverview(req, res, next) {
  try {
    const [byType, totals, recent] = await Promise.all([
      query(
        `SELECT type, COUNT(*) AS count, COALESCE(SUM(is_read = 0), 0) AS unread
         FROM notifications GROUP BY type ORDER BY count DESC`
      ),
      query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(is_read = 0), 0) AS unread FROM notifications`
      ),
      query(
        `SELECT n.id, n.type, n.is_read, n.created_at, n.user_id, n.post_id,
           fu.username AS from_username, tu.username AS to_username
         FROM notifications n
         JOIN users fu ON fu.id = n.from_user_id
         JOIN users tu ON tu.id = n.user_id
         ORDER BY n.created_at DESC
         LIMIT 20`
      ),
    ]);

    return sendSuccess(res, 'Notification overview retrieved', {
      totals: {
        total: Number((totals[0] || {}).total || 0),
        unread: Number((totals[0] || {}).unread || 0),
      },
      byType: byType.map((r) => ({
        type: r.type,
        count: Number(r.count),
        unread: Number(r.unread),
      })),
      recent,
    });
  } catch (error) {
    next(error);
  }
}

async function getConnectionsOverview(req, res, next) {
  try {
    const { page, limit, offset } = parsePageLimit(req);
    const filters = ['1=1'];
    const params = [];

    if (['pending', 'accepted', 'rejected'].includes(req.query.status)) {
      filters.push('c.status = ?');
      params.push(req.query.status);
    }
    const where = filters.join(' AND ');

    const [stats, countResult, rows] = await Promise.all([
      query(`SELECT status, COUNT(*) AS count FROM connections GROUP BY status`),
      query(`SELECT COUNT(*) AS total FROM connections c WHERE ${where}`, params),
      query(
        `SELECT c.id, c.status, c.created_at, c.updated_at,
           ru.username AS requester_username, ru.full_name AS requester_full_name,
           au.username AS addressee_username, au.full_name AS addressee_full_name
         FROM connections c
         JOIN users ru ON ru.id = c.requester_id
         JOIN users au ON au.id = c.addressee_id
         WHERE ${where}
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);

    const total = Number((countResult[0] || {}).total || 0);
    return sendSuccess(res, 'Connections retrieved', {
      stats: stats.map((r) => ({ status: r.status, count: Number(r.count) })),
      connections: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

async function removeConnection(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return sendError(res, 'Invalid connection id', null, 400);

    const connection = await queryOne(
      `SELECT c.id, c.status, ru.username AS requester, au.username AS addressee
       FROM connections c
       JOIN users ru ON ru.id = c.requester_id
       JOIN users au ON au.id = c.addressee_id
       WHERE c.id = ?`,
      [id]
    );
    if (!connection) return sendError(res, 'Connection not found', null, 404);

    await execute('DELETE FROM connections WHERE id = ?', [id]);

    await logAudit(req, {
      action: 'connection.remove',
      entityType: 'connection',
      entityId: id,
      details: `${connection.requester} -> ${connection.addressee} (${connection.status})`,
    });

    return sendSuccess(res, 'Connection removed');
  } catch (error) {
    next(error);
  }
}

async function getBlocks(req, res, next) {
  try {
    const { page, limit, offset } = parsePageLimit(req);
    const [countResult, rows] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM user_blocks'),
      query(
        `SELECT b.id, b.created_at,
           bu.username AS blocker_username, bu.full_name AS blocker_full_name,
           du.username AS blocked_username, du.full_name AS blocked_full_name
         FROM user_blocks b
         JOIN users bu ON bu.id = b.blocker_id
         JOIN users du ON du.id = b.blocked_id
         ORDER BY b.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
    ]);

    const total = Number((countResult[0] || {}).total || 0);
    return sendSuccess(res, 'Blocks retrieved', {
      blocks: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

async function removeBlock(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return sendError(res, 'Invalid block id', null, 400);

    const block = await queryOne(
      `SELECT b.id, bu.username AS blocker, du.username AS blocked
       FROM user_blocks b
       JOIN users bu ON bu.id = b.blocker_id
       JOIN users du ON du.id = b.blocked_id
       WHERE b.id = ?`,
      [id]
    );
    if (!block) return sendError(res, 'Block not found', null, 404);

    await execute('DELETE FROM user_blocks WHERE id = ?', [id]);

    await logAudit(req, {
      action: 'block.remove',
      entityType: 'user_block',
      entityId: id,
      details: `${block.blocker} unblocked ${block.blocked}`,
    });

    return sendSuccess(res, 'Block removed');
  } catch (error) {
    next(error);
  }
}

async function getLiveSessions(req, res, next) {
  try {
    const { page, limit, offset } = parsePageLimit(req);
    const filters = ['1=1'];
    const params = [];

    if (['live', 'ended'].includes(req.query.status)) {
      filters.push('ls.status = ?');
      params.push(req.query.status);
    }
    const q = String(req.query.q || '').trim();
    if (q) {
      filters.push('(ls.title LIKE ? OR u.username LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const where = filters.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM live_sessions ls JOIN users u ON u.id = ls.creator_id WHERE ${where}`,
      params
    );
    const rows = await query(
      `SELECT ls.id, ls.title, ls.status, ls.started_at, ls.ended_at, ls.viewer_visibility,
         ls.creator_id, u.username, u.full_name, u.profile_image_url,
         (SELECT COUNT(*) FROM live_viewers lv WHERE lv.live_session_id = ls.id AND lv.left_at IS NULL) AS current_viewers,
         (SELECT COUNT(*) FROM live_viewers lv WHERE lv.live_session_id = ls.id) AS total_viewers,
         (SELECT COUNT(*) FROM live_reports lr WHERE lr.live_session_id = ls.id AND lr.status = 'open') AS open_reports
       FROM live_sessions ls
       JOIN users u ON u.id = ls.creator_id
       WHERE ${where}
       ORDER BY ls.started_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = Number((countResult[0] || {}).total || 0);
    return sendSuccess(res, 'Live sessions retrieved', {
      sessions: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

async function endLiveSession(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return sendError(res, 'Invalid live session id', null, 400);

    const session = await queryOne(
      'SELECT id, title, status, creator_id FROM live_sessions WHERE id = ?',
      [id]
    );
    if (!session) return sendError(res, 'Live session not found', null, 404);
    if (session.status === 'ended') return sendError(res, 'Live session already ended', null, 400);

    await execute("UPDATE live_sessions SET status = 'ended', ended_at = NOW() WHERE id = ?", [id]);
    await execute(
      'UPDATE live_viewers SET left_at = NOW() WHERE live_session_id = ? AND left_at IS NULL',
      [id]
    );

    await logAudit(req, {
      action: 'live.end',
      entityType: 'live_session',
      entityId: id,
      details: `ended by admin | title: ${session.title}`,
    });

    return sendSuccess(res, 'Live session ended');
  } catch (error) {
    next(error);
  }
}

async function getReportedConversation(req, res, next) {
  try {
    const firstId = parseInt(req.params.userIdA, 10);
    const secondId = parseInt(req.params.userIdB, 10);
    if (!Number.isInteger(firstId) || !Number.isInteger(secondId) || firstId < 1 || secondId < 1) {
      return sendError(res, 'Invalid user ids', null, 400);
    }
    if (firstId === secondId) {
      return sendError(res, 'Provide two different users', null, 400);
    }

    const [first, second] = await Promise.all([
      queryOne('SELECT id, username FROM users WHERE id = ?', [firstId]),
      queryOne('SELECT id, username FROM users WHERE id = ?', [secondId]),
    ]);
    if (!first || !second) return sendError(res, 'User not found', null, 404);

    const messages = await query(
      `SELECT id, sender_id, receiver_id, message_type, message_text, media_url, is_read, created_at
       FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at ASC
       LIMIT 200`,
      [firstId, secondId, secondId, firstId]
    );

    await logAudit(req, {
      action: 'messages.accessed',
      entityType: 'conversation',
      entityId: null,
      details: `conversation between '${first.username}' (#${firstId}) and '${second.username}' (#${secondId}) - ${messages.length} messages`,
    });

    return sendSuccess(res, 'Conversation retrieved', {
      participants: [first, second],
      messages,
      total: messages.length,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAuditLogs,
  getRoles,
  getNotificationsOverview,
  getConnectionsOverview,
  removeConnection,
  getBlocks,
  removeBlock,
  getLiveSessions,
  endLiveSession,
  getReportedConversation,
  STAFF_ROLES,
};
