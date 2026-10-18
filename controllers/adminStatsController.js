const { query } = require('../config/database');
const { sendSuccess } = require('../utils/response');

const METRIC_DEFINITIONS = {
  active_users_7d: 'Users with last_active_at within the last 7 days',
  pending_reports: 'Reports with status "open" across post, comment, user, live and message reports',
  under_review_reports: 'Reports with status "reviewed"',
  total_media: 'Gallery items + posts without gallery entries + status updates',
  new_today: 'Accounts created since 00:00 server time today',
};

async function getOverview(req, res, next) {
  try {
    const [
      userStats,
      postStats,
      commentStats,
      reportStats,
      reportedStats,
      liveStats,
      mediaStats,
      miscStats,
      registrationsTrend,
      postsTrend,
      commentsTrend,
      recentSignups,
      recentAudit,
    ] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(created_at >= CURDATE()), 0) AS new_today,
           COALESCE(SUM(created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS new_month,
           COALESCE(SUM(created_at >= NOW() - INTERVAL 7 DAY), 0) AS new_7d,
           COALESCE(SUM(last_active_at >= NOW() - INTERVAL 7 DAY), 0) AS active_7d,
           COALESCE(SUM(last_active_at >= NOW() - INTERVAL 30 DAY), 0) AS active_30d,
           COALESCE(SUM(is_active = 0), 0) AS suspended
         FROM users`
      ),
      query(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(is_hidden = 1), 0) AS hidden,
           COALESCE(SUM(created_at >= NOW() - INTERVAL 7 DAY), 0) AS new_7d
         FROM posts`
      ),
      query('SELECT COUNT(*) AS total FROM comments'),
      query(
        `SELECT
           (SELECT COUNT(*) FROM post_reports WHERE status = 'open')
           + (SELECT COUNT(*) FROM comment_reports WHERE status = 'open')
           + (SELECT COUNT(*) FROM user_reports WHERE status = 'open')
           + (SELECT COUNT(*) FROM live_reports WHERE status = 'open')
           + (SELECT COUNT(*) FROM message_reports WHERE status = 'open') AS pending,
           (SELECT COUNT(*) FROM post_reports WHERE status = 'reviewed')
           + (SELECT COUNT(*) FROM comment_reports WHERE status = 'reviewed')
           + (SELECT COUNT(*) FROM user_reports WHERE status = 'reviewed')
           + (SELECT COUNT(*) FROM live_reports WHERE status = 'reviewed')
           + (SELECT COUNT(*) FROM message_reports WHERE status = 'reviewed') AS under_review,
           (SELECT COUNT(*) FROM post_reports)
           + (SELECT COUNT(*) FROM comment_reports)
           + (SELECT COUNT(*) FROM user_reports)
           + (SELECT COUNT(*) FROM live_reports)
           + (SELECT COUNT(*) FROM message_reports) AS total`
      ),
      query(
        `SELECT
           (SELECT COUNT(DISTINCT post_id) FROM post_reports WHERE status = 'open') AS reported_posts,
           (SELECT COUNT(DISTINCT comment_id) FROM comment_reports WHERE status = 'open') AS reported_comments,
           (SELECT COUNT(DISTINCT reported_id) FROM user_reports WHERE status = 'open') AS reported_accounts,
           (SELECT COUNT(DISTINCT message_id) FROM message_reports WHERE status = 'open') AS reported_messages`
      ),
      query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'live'), 0) AS live_now FROM live_sessions`
      ),
      query(
        `SELECT (SELECT COUNT(*) FROM post_media)
           + (SELECT COUNT(*) FROM posts p WHERE NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id))
           + (SELECT COUNT(*) FROM statuses) AS total_media`
      ),
      query(
        `SELECT
           (SELECT COUNT(*) FROM connections WHERE status = 'pending') AS pending_connections,
           (SELECT COUNT(*) FROM user_blocks) AS total_blocks,
           (SELECT COUNT(*) FROM messages) AS total_messages,
           (SELECT COUNT(*) FROM follows) AS total_follows`
      ),
      query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM users
         WHERE created_at >= NOW() - INTERVAL 30 DAY
         GROUP BY DATE(created_at) ORDER BY d`
      ),
      query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM posts
         WHERE created_at >= NOW() - INTERVAL 30 DAY
         GROUP BY DATE(created_at) ORDER BY d`
      ),
      query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM comments
         WHERE created_at >= NOW() - INTERVAL 30 DAY
         GROUP BY DATE(created_at) ORDER BY d`
      ),
      query(
        `SELECT id, username, full_name, profile_image_url, is_verified, created_at
         FROM users ORDER BY created_at DESC LIMIT 5`
      ),
      query(
        `SELECT id, actor_username, action, entity_type, entity_id, created_at
         FROM admin_audit_logs ORDER BY id DESC LIMIT 6`
      ),
    ]);

    const u = userStats[0] || {};
    const p = postStats[0] || {};
    const c = commentStats[0] || {};
    const r = reportStats[0] || {};
    const rep = reportedStats[0] || {};
    const l = liveStats[0] || {};
    const m = mediaStats[0] || {};
    const misc = miscStats[0] || {};

    return sendSuccess(res, 'Overview retrieved', {
      stats: {
        totalUsers: Number(u.total || 0),
        newUsersToday: Number(u.new_today || 0),
        newUsersThisMonth: Number(u.new_month || 0),
        newUsers7d: Number(u.new_7d || 0),
        activeUsers7d: Number(u.active_7d || 0),
        activeUsers30d: Number(u.active_30d || 0),
        suspendedUsers: Number(u.suspended || 0),
        totalPosts: Number(p.total || 0),
        hiddenPosts: Number(p.hidden || 0),
        newPosts7d: Number(p.new_7d || 0),
        totalComments: Number(c.total || 0),
        totalMedia: Number(m.total_media || 0),
        pendingReports: Number(r.pending || 0),
        underReviewReports: Number(r.under_review || 0),
        totalReports: Number(r.total || 0),
        openReports: Number(r.pending || 0),
        reportedPosts: Number(rep.reported_posts || 0),
        reportedComments: Number(rep.reported_comments || 0),
        reportedAccounts: Number(rep.reported_accounts || 0),
        reportedMessages: Number(rep.reported_messages || 0),
        liveTotal: Number(l.total || 0),
        liveNow: Number(l.live_now || 0),
        pendingConnections: Number(misc.pending_connections || 0),
        totalBlocks: Number(misc.total_blocks || 0),
        totalMessages: Number(misc.total_messages || 0),
        totalFollows: Number(misc.total_follows || 0),
        totalConnections: Number(misc.pending_connections || 0) + Number(misc.total_follows || 0),
        activeLiveSessions: Number(l.live_now || 0),
      },
      trends: {
        registrations: registrationsTrend.map((row) => ({ date: row.d, count: Number(row.c) })),
        posts: postsTrend.map((row) => ({ date: row.d, count: Number(row.c) })),
        comments: commentsTrend.map((row) => ({ date: row.d, count: Number(row.c) })),
      },
      recent: {
        signups: recentSignups,
        users: recentSignups,
        audit: recentAudit,
      },
      metricDefinitions: METRIC_DEFINITIONS,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getOverview };
