const { query, queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../services/auditService');
const { hasPermission } = require('../utils/permissions');

const REPORT_TYPES = ['post', 'comment', 'user', 'live', 'message'];
const REPORT_STATUSES = ['open', 'reviewed', 'resolved', 'dismissed'];

const TABLES = {
  post: { table: 'post_reports', targetColumn: 'post_id' },
  comment: { table: 'comment_reports', targetColumn: 'comment_id' },
  user: { table: 'user_reports', targetColumn: 'reported_id' },
  live: { table: 'live_reports', targetColumn: 'live_session_id' },
  message: { table: 'message_reports', targetColumn: 'message_id' },
};

function branchSql(type) {
  const commonTail = `
      pr.reporter_id, ru.username AS reporter_username, ru.full_name AS reporter_full_name,
      pr.assigned_to, pr.reviewed_by, pr.reviewed_at, pr.resolution_note`;

  switch (type) {
    case 'post':
      return `
        SELECT 'post' AS type, pr.id, pr.status, pr.reason, pr.created_at,
          p.user_id AS target_owner_id, tu.username AS target_username,
          p.id AS target_ref_id, LEFT(COALESCE(p.caption, '[no caption]'), 200) AS target_snippet,
          p.is_hidden AS target_is_hidden,
          ${commonTail}
        FROM post_reports pr
        JOIN users ru ON ru.id = pr.reporter_id
        JOIN posts p ON p.id = pr.post_id
        JOIN users tu ON tu.id = p.user_id`;
    case 'comment':
      return `
        SELECT 'comment' AS type, pr.id, pr.status, pr.reason, pr.created_at,
          c.user_id AS target_owner_id, tu.username AS target_username,
          c.id AS target_ref_id, LEFT(COALESCE(c.comment_text, '[no text]'), 200) AS target_snippet,
          0 AS target_is_hidden,
          ${commonTail}
        FROM comment_reports pr
        JOIN users ru ON ru.id = pr.reporter_id
        JOIN comments c ON c.id = pr.comment_id
        JOIN users tu ON tu.id = c.user_id`;
    case 'user':
      return `
        SELECT 'user' AS type, pr.id, pr.status, pr.reason, pr.created_at,
          tu.id AS target_owner_id, tu.username AS target_username,
          tu.id AS target_ref_id, LEFT(COALESCE(tu.bio, '[no bio]'), 200) AS target_snippet,
          (tu.is_active = 0) AS target_is_hidden,
          ${commonTail}
        FROM user_reports pr
        JOIN users ru ON ru.id = pr.reporter_id
        JOIN users tu ON tu.id = pr.reported_id`;
    case 'live':
      return `
        SELECT 'live' AS type, pr.id, pr.status, pr.reason, pr.created_at,
          ls.creator_id AS target_owner_id, tu.username AS target_username,
          ls.id AS target_ref_id, CONCAT('Live: ', ls.title, ' [', ls.status, ']') AS target_snippet,
          (ls.status = 'ended') AS target_is_hidden,
          ${commonTail}
        FROM live_reports pr
        JOIN users ru ON ru.id = pr.reporter_id
        JOIN live_sessions ls ON ls.id = pr.live_session_id
        JOIN users tu ON tu.id = ls.creator_id`;
    case 'message':
      return `
        SELECT 'message' AS type, pr.id, pr.status, pr.reason, pr.created_at,
          m.sender_id AS target_owner_id, tu.username AS target_username,
          m.id AS target_ref_id,
          LEFT(COALESCE(m.message_text, CONCAT('[', m.message_type, ' media]')), 200) AS target_snippet,
          0 AS target_is_hidden,
          ${commonTail}
        FROM message_reports pr
        JOIN users ru ON ru.id = pr.reporter_id
        JOIN messages m ON m.id = pr.message_id
        JOIN users tu ON tu.id = m.sender_id`;
    default:
      throw new Error(`Unknown report type: ${type}`);
  }
}

function buildBranches({ type, status, from, to }) {
  const types = type && TABLES[type] ? [type] : REPORT_TYPES;
  const branches = [];
  const params = [];

  for (const t of types) {
    let sql = branchSql(t);
    const conditions = [];
    if (status && REPORT_STATUSES.includes(status)) {
      conditions.push('pr.status = ?');
      params.push(status);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) {
      conditions.push('pr.created_at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) {
      conditions.push('pr.created_at <= ?');
      params.push(`${to} 23:59:59`);
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    branches.push(sql);
  }
  return { branches, params };
}

async function listReports(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const type = REPORT_TYPES.includes(req.query.type) ? req.query.type : null;
    const status = REPORT_STATUSES.includes(req.query.status) ? req.query.status : null;

    const { branches, params } = buildBranches({
      type,
      status,
      from: req.query.from,
      to: req.query.to,
    });

    const inner = branches.join(' UNION ALL ');
    const [rows, countRows] = await Promise.all([
      query(
        `SELECT * FROM (${inner}) t ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) AS total FROM (${inner}) t`, params),
    ]);

    const total = Number((countRows[0] || {}).total || 0);

    return sendSuccess(res, 'Reports retrieved', {
      reports: rows,
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

function resolveReportParams(req, res) {
  const type = req.params.type;
  if (!REPORT_TYPES.includes(type)) {
    sendError(res, 'Invalid report type', null, 400);
    return null;
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    sendError(res, 'Invalid report id', null, 400);
    return null;
  }
  return { type, id, table: TABLES[type].table };
}

async function getReportDetail(req, res, next) {
  try {
    const ctx = resolveReportParams(req, res);
    if (!ctx) return;

    const rows = await query(
      `SELECT * FROM (${branchSql(ctx.type)}) t WHERE t.id = ?`,
      [ctx.id]
    );
    const report = rows[0];
    if (!report) return sendError(res, 'Report not found', null, 404);

    const notes = await query(
      `SELECT id, author_username, note, created_at FROM report_notes
       WHERE report_type = ? AND report_id = ? ORDER BY created_at ASC`,
      [ctx.type, ctx.id]
    );

    let targetDetail = null;
    if (ctx.type === 'post') {
      targetDetail = await queryOne(
        `SELECT p.id, p.caption, p.media_type, p.media_url, p.audience, p.is_hidden,
           p.hidden_reason, p.created_at, u.username
         FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
        [report.target_ref_id]
      );
    } else if (ctx.type === 'comment') {
      targetDetail = await queryOne(
        `SELECT c.id, c.comment_text, c.media_url, c.created_at, c.post_id, u.username
         FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
        [report.target_ref_id]
      );
    } else if (ctx.type === 'message') {
      targetDetail = await queryOne(
        `SELECT m.id, m.message_type, m.message_text, m.media_url, m.created_at,
           su.username AS sender_username, ru.username AS receiver_username
         FROM messages m
         JOIN users su ON su.id = m.sender_id
         JOIN users ru ON ru.id = m.receiver_id
         WHERE m.id = ?`,
        [report.target_ref_id]
      );
    } else if (ctx.type === 'user') {
      targetDetail = await queryOne(
        `SELECT id, username, full_name, bio, role, is_active, is_verified, created_at,
           last_active_at, profile_image_url
         FROM users WHERE id = ?`,
        [report.target_ref_id]
      );
    } else if (ctx.type === 'live') {
      targetDetail = await queryOne(
        `SELECT ls.id, ls.title, ls.status, ls.started_at, ls.ended_at, ls.viewer_visibility,
           u.username AS creator_username
         FROM live_sessions ls JOIN users u ON u.id = ls.creator_id WHERE ls.id = ?`,
        [report.target_ref_id]
      );
    }

    return sendSuccess(res, 'Report retrieved', { report, notes, targetDetail });
  } catch (error) {
    next(error);
  }
}

async function updateReportStatus(req, res, next) {
  try {
    const ctx = resolveReportParams(req, res);
    if (!ctx) return;

    const status = String(req.body.status || '');
    if (!REPORT_STATUSES.includes(status)) {
      return sendError(res, `Status must be one of: ${REPORT_STATUSES.join(', ')}`, null, 400);
    }
    const note = req.body.note ? String(req.body.note).trim().slice(0, 500) : null;
    if (req.body.note && !note) {
      return sendError(res, 'Note cannot be empty', null, 400);
    }

    const existing = await queryOne(
      `SELECT id, status FROM ${ctx.table} WHERE id = ?`,
      [ctx.id]
    );
    if (!existing) return sendError(res, 'Report not found', null, 404);

    await execute(
      `UPDATE ${ctx.table}
       SET status = ?, reviewed_by = ?, reviewed_at = NOW(), resolution_note = ?
       WHERE id = ?`,
      [status, req.user.id, note, ctx.id]
    );

    await logAudit(req, {
      action: 'report.status',
      entityType: `${ctx.type}_report`,
      entityId: ctx.id,
      details: `${existing.status} -> ${status}${note ? ` | note: ${note}` : ''}`,
    });

    return sendSuccess(res, 'Report updated', { status });
  } catch (error) {
    next(error);
  }
}

async function assignReport(req, res, next) {
  try {
    const ctx = resolveReportParams(req, res);
    if (!ctx) return;

    const assigneeId = parseInt(req.body.assignee_id, 10);
    if (!Number.isInteger(assigneeId) || assigneeId < 1) {
      return sendError(res, 'assignee_id must be a valid user id', null, 400);
    }

    const assignee = await queryOne(
      'SELECT id, username, role FROM users WHERE id = ? AND is_active = 1',
      [assigneeId]
    );
    if (!assignee) return sendError(res, 'Assignee not found or inactive', null, 404);
    if (!hasPermission(assignee.role, 'reports.write')) {
      return sendError(res, 'Assignee cannot handle reports', null, 400);
    }

    const existing = await queryOne(
      `SELECT id FROM ${ctx.table} WHERE id = ?`,
      [ctx.id]
    );
    if (!existing) return sendError(res, 'Report not found', null, 404);

    await execute(`UPDATE ${ctx.table} SET assigned_to = ? WHERE id = ?`, [
      assigneeId,
      ctx.id,
    ]);

    await logAudit(req, {
      action: 'report.assign',
      entityType: `${ctx.type}_report`,
      entityId: ctx.id,
      details: `assigned to ${assignee.username} (${assignee.role})`,
    });

    return sendSuccess(res, 'Report assigned', {
      assignee: { id: assignee.id, username: assignee.username, role: assignee.role },
    });
  } catch (error) {
    next(error);
  }
}

async function addReportNote(req, res, next) {
  try {
    const ctx = resolveReportParams(req, res);
    if (!ctx) return;

    const note = String(req.body.note || '').trim();
    if (!note || note.length > 1000) {
      return sendError(res, 'A note is required (max 1000 characters)', null, 400);
    }

    const existing = await queryOne(
      `SELECT id FROM ${ctx.table} WHERE id = ?`,
      [ctx.id]
    );
    if (!existing) return sendError(res, 'Report not found', null, 404);

    const result = await execute(
      `INSERT INTO report_notes (report_type, report_id, author_id, author_username, note)
       VALUES (?, ?, ?, ?, ?)`,
      [ctx.type, ctx.id, req.user.id, req.user.username, note]
    );

    await logAudit(req, {
      action: 'report.note',
      entityType: `${ctx.type}_report`,
      entityId: ctx.id,
      details: note.slice(0, 200),
    });

    return sendSuccess(res, 'Note added', { id: result.insertId }, 201);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listReports,
  getReportDetail,
  updateReportStatus,
  assignReport,
  addReportNote,
  REPORT_TYPES,
  REPORT_STATUSES,
};
