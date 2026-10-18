const { query } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

const MAX_RANGE_DAYS = 366;

function parseRange(req, res) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let to = String(req.query.to || '').trim();
  let from = String(req.query.from || '').trim();

  if (!datePattern.test(to)) to = formatDate(today);
  if (!datePattern.test(from)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    from = formatDate(d);
  }
  if (from > to) {
    sendError(res, 'from must be before to', null, 400);
    return null;
  }
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) {
    sendError(res, `Date range cannot exceed ${MAX_RANGE_DAYS} days`, null, 400);
    return null;
  }
  return { from, to, fromTs: `${from} 00:00:00`, toTs: `${to} 23:59:59` };
}

function zeroFillSeries(rows, from, to, valueFn) {
  const map = new Map(rows.map((r) => [r.d, valueFn(r)]));
  const out = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ date: key, count: map.get(key) || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function bucketBy(daily, mode) {
  const buckets = new Map();
  for (const { date, count } of daily) {
    let key;
    if (mode === 'week') {
      const d = new Date(`${date}T00:00:00Z`);
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day);
      key = d.toISOString().slice(0, 10);
    } else {
      key = date.slice(0, 7);
    }
    buckets.set(key, (buckets.get(key) || 0) + count);
  }
  return [...buckets.entries()].map(([label, count]) => ({ label, count }));
}

const ACTIVITY_SOURCES = [
  'SELECT DATE(created_at) AS d, user_id AS uid FROM posts',
  'SELECT DATE(created_at) AS d, user_id AS uid FROM comments',
  'SELECT DATE(created_at) AS d, user_id AS uid FROM post_likes',
  'SELECT DATE(created_at) AS d, sender_id AS uid FROM messages',
  'SELECT DATE(created_at) AS d, user_id AS uid FROM statuses',
];

async function getAnalytics(req, res, next) {
  try {
    const range = parseRange(req, res);
    if (!range) return;
    const { from, to, fromTs, toTs } = range;

    const activityUnion = ACTIVITY_SOURCES.map((s) => `${s} WHERE created_at >= ? AND created_at <= ?`).join('\n UNION ALL\n');

    const [
      userGrowth,
      dauRows,
      postsDaily,
      commentsDaily,
      likesDaily,
      messagesDaily,
      actionSummary,
      resolutionStats,
      mediaCounts,
      userTotals,
    ] = await Promise.all([
      query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM users
         WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at) ORDER BY d`,
        [fromTs, toTs]
      ),
      query(
        `SELECT d, COUNT(DISTINCT uid) AS c FROM (${activityUnion}) t
         GROUP BY d ORDER BY d`,
        [fromTs, toTs, fromTs, toTs, fromTs, toTs, fromTs, toTs, fromTs, toTs]
      ),
      query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM posts
         WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at) ORDER BY d`,
        [fromTs, toTs]
      ),
      query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM comments
         WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at) ORDER BY d`,
        [fromTs, toTs]
      ),
      query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM post_likes
         WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at) ORDER BY d`,
        [fromTs, toTs]
      ),
      query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM messages
         WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at) ORDER BY d`,
        [fromTs, toTs]
      ),
      query(
        `SELECT action, COUNT(*) AS c FROM admin_audit_logs
         WHERE created_at >= ? AND created_at <= ?
         GROUP BY action ORDER BY c DESC`,
        [fromTs, toTs]
      ),
      query(
        `SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, reviewed_at)) AS avg_hours,
           COUNT(*) AS resolved_count
         FROM (
           SELECT created_at, reviewed_at FROM post_reports WHERE reviewed_at >= ? AND reviewed_at <= ?
           UNION ALL
           SELECT created_at, reviewed_at FROM comment_reports WHERE reviewed_at >= ? AND reviewed_at <= ?
           UNION ALL
           SELECT created_at, reviewed_at FROM user_reports WHERE reviewed_at >= ? AND reviewed_at <= ?
           UNION ALL
           SELECT created_at, reviewed_at FROM live_reports WHERE reviewed_at >= ? AND reviewed_at <= ?
           UNION ALL
           SELECT created_at, reviewed_at FROM message_reports WHERE reviewed_at >= ? AND reviewed_at <= ?
         ) t`,
        [fromTs, toTs, fromTs, toTs, fromTs, toTs, fromTs, toTs, fromTs, toTs]
      ),
      query(
        `SELECT
           (SELECT COUNT(*) FROM posts) AS posts,
           (SELECT COUNT(*) FROM post_media) AS gallery,
           (SELECT COUNT(*) FROM statuses) AS statuses`
      ),
      query(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(last_active_at >= NOW() - INTERVAL 7 DAY), 0) AS active_7d
         FROM users`
      ),
    ]);

    const registrations = zeroFillSeries(
      userGrowth.map((r) => ({ d: r.d, c: Number(r.c) })),
      from,
      to,
      (r) => r.c
    );
    let cumulative = 0;
    const cumulativeSeries = registrations.map((row) => {
      cumulative += row.count;
      return { date: row.date, count: row.count, cumulative };
    });

    const dau = zeroFillSeries(dauRows.map((r) => ({ d: r.d, c: Number(r.c) })), from, to, (r) => r.c);
    const posts = zeroFillSeries(postsDaily.map((r) => ({ d: r.d, c: Number(r.c) })), from, to, (r) => r.c);
    const comments = zeroFillSeries(commentsDaily.map((r) => ({ d: r.d, c: Number(r.c) })), from, to, (r) => r.c);
    const likes = zeroFillSeries(likesDaily.map((r) => ({ d: r.d, c: Number(r.c) })), from, to, (r) => r.c);
    const messages = zeroFillSeries(messagesDaily.map((r) => ({ d: r.d, c: Number(r.c) })), from, to, (r) => r.c);

    const engagement = dau.map((row, i) => ({
      date: row.date,
      likes: likes[i].count,
      comments: comments[i].count,
      count: likes[i].count + comments[i].count,
    }));

    const activeInPeriod = await query(
      `SELECT COUNT(DISTINCT uid) AS c FROM (${activityUnion}) t`,
      [fromTs, toTs, fromTs, toTs, fromTs, toTs, fromTs, toTs, fromTs, toTs]
    );

    const totals = userTotals[0] || {};
    const resolution = resolutionStats[0] || {};
    const media = mediaCounts[0] || {};

    return sendSuccess(res, 'Analytics retrieved', {
      range: { from, to },
      metricDefinitions: {
        active: 'Distinct users who created a post, comment, like, message or status in the period',
        dau: 'Distinct users with any activity per day',
        engagement: 'Likes + comments per day',
        resolution_avg_hours: 'Average hours from report creation to first review, for resolved/reviewed reports',
      },
      kpi: {
        totalUsers: Number(totals.total || 0),
        newUsers: registrations.reduce((sum, r) => sum + r.count, 0),
        activeUsersInPeriod: Number((activeInPeriod[0] || {}).c || 0),
        activeUsers7d: Number(totals.active_7d || 0),
        posts: posts.reduce((sum, r) => sum + r.count, 0),
        comments: comments.reduce((sum, r) => sum + r.count, 0),
        likes: likes.reduce((sum, r) => sum + r.count, 0),
        messages: messages.reduce((sum, r) => sum + r.count, 0),
        avgDau: Math.round(dau.reduce((s, r) => s + r.count, 0) / Math.max(1, dau.length)),
        resolutionAvgHours:
          resolution.avg_hours != null ? Math.round(Number(resolution.avg_hours)) : null,
        reportsResolved: Number(resolution.resolved_count || 0),
        moderationActions: actionSummary.reduce((s, r) => s + Number(r.c), 0),
        suspensions: Number(
          (actionSummary.find((a) => a.action === 'user.suspend') || {}).c || 0
        ),
      },
      series: {
        registrations: cumulativeSeries,
        dau,
        wau: bucketBy(dau, 'week'),
        mau: bucketBy(dau, 'month'),
        posts,
        comments,
        engagement,
        messages,
      },
      topActions: actionSummary.map((r) => ({ action: r.action, count: Number(r.c) })),
      mediaBreakdown: {
        posts: Number(media.posts || 0),
        gallery: Number(media.gallery || 0),
        statuses: Number(media.statuses || 0),
      },
    });
  } catch (error) {
    next(error);
  }
}

function csvCell(value) {
  let cell = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\n\r]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function toCsv(header, rows) {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

async function exportAnalytics(req, res, next) {
  try {
    const range = parseRange(req, res);
    if (!range) return;
    const { from, to, fromTs, toTs } = range;
    const report = String(req.query.report || '');

    let csv = null;
    let filename = null;

    if (report === 'users') {
      const rows = await query(
        `SELECT id, username, full_name, role,
           CASE WHEN is_active = 1 THEN 'active' ELSE 'suspended' END AS status,
           is_verified, created_at
         FROM users WHERE created_at >= ? AND created_at <= ?
         ORDER BY created_at DESC`,
        [fromTs, toTs]
      );
      csv = toCsv(
        ['id', 'username', 'full_name', 'role', 'status', 'verified', 'created_at'],
        rows.map((r) => [r.id, r.username, r.full_name, r.role, r.status, r.is_verified, r.created_at])
      );
      filename = `rubavu-users-${from}-to-${to}.csv`;
    } else if (report === 'growth') {
      const rows = await query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM users
         WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at) ORDER BY d`,
        [fromTs, toTs]
      );
      let cum = Number((await query(`SELECT COUNT(*) AS total FROM users WHERE created_at < ?`, [fromTs]))[0].total || 0);
      const out = rows.map((r) => {
        cum += Number(r.c);
        return [r.d, r.c, cum];
      });
      csv = toCsv(['date', 'new_users', 'cumulative_users'], out);
      filename = `rubavu-growth-${from}-to-${to}.csv`;
    } else if (report === 'content') {
      const [posts, comments] = await Promise.all([
        query(
          `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM posts
           WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at)`,
          [fromTs, toTs]
        ),
        query(
          `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM comments
           WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at)`,
          [fromTs, toTs]
        ),
      ]);
      const map = new Map();
      for (const p of posts) map.set(p.d, { posts: Number(p.c), comments: 0 });
      for (const c of comments) {
        const entry = map.get(c.d) || { posts: 0, comments: 0 };
        entry.comments = Number(c.c);
        map.set(c.d, entry);
      }
      const out = [...map.entries()]
        .sort()
        .map(([date, v]) => [date, v.posts, v.comments]);
      csv = toCsv(['date', 'posts', 'comments'], out);
      filename = `rubavu-content-${from}-to-${to}.csv`;
    } else if (report === 'engagement') {
      const [likes, comments] = await Promise.all([
        query(
          `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM post_likes
           WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at)`,
          [fromTs, toTs]
        ),
        query(
          `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM comments
           WHERE created_at >= ? AND created_at <= ? GROUP BY DATE(created_at)`,
          [fromTs, toTs]
        ),
      ]);
      const map = new Map();
      for (const l of likes) map.set(l.d, { likes: Number(l.c), comments: 0 });
      for (const c of comments) {
        const entry = map.get(c.d) || { likes: 0, comments: 0 };
        entry.comments = Number(c.c);
        map.set(c.d, entry);
      }
      const out = [...map.entries()]
        .sort()
        .map(([date, v]) => [date, v.likes, v.comments, v.likes + v.comments]);
      csv = toCsv(['date', 'likes', 'comments', 'engagement_total'], out);
      filename = `rubavu-engagement-${from}-to-${to}.csv`;
    } else if (report === 'moderation') {
      const rows = await query(
        `SELECT action, COUNT(*) AS c FROM admin_audit_logs
         WHERE created_at >= ? AND created_at <= ?
         GROUP BY action ORDER BY c DESC`,
        [fromTs, toTs]
      );
      csv = toCsv(['action', 'count'], rows.map((r) => [r.action, r.c]));
      filename = `rubavu-moderation-${from}-to-${to}.csv`;
    } else if (report === 'reports') {
      const rows = await query(
        `SELECT 'post' AS type, status, COUNT(*) AS c FROM post_reports WHERE created_at >= ? AND created_at <= ? GROUP BY status
         UNION ALL SELECT 'comment', status, COUNT(*) FROM comment_reports WHERE created_at >= ? AND created_at <= ? GROUP BY status
         UNION ALL SELECT 'user', status, COUNT(*) FROM user_reports WHERE created_at >= ? AND created_at <= ? GROUP BY status
         UNION ALL SELECT 'live', status, COUNT(*) FROM live_reports WHERE created_at >= ? AND created_at <= ? GROUP BY status
         UNION ALL SELECT 'message', status, COUNT(*) FROM message_reports WHERE created_at >= ? AND created_at <= ? GROUP BY status`,
        [fromTs, toTs, fromTs, toTs, fromTs, toTs, fromTs, toTs, fromTs, toTs]
      );
      csv = toCsv(['report_type', 'status', 'count'], rows.map((r) => [r.type, r.status, r.c]));
      filename = `rubavu-reports-${from}-to-${to}.csv`;
    } else {
      return sendError(
        res,
        'report must be one of: users, growth, content, engagement, moderation, reports',
        null,
        400
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
}

module.exports = { getAnalytics, exportAnalytics };
