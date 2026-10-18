const request = require('supertest');
const app = require('../server');
const { execute, query } = require('../config/database');
const { runMigration: runRbacMigration } = require('../database/migrations/009_add_rbac_and_audit');
const { runMigration: runModerationMigration } = require('../database/migrations/010_moderation_fields');
const { runMigration: runMessageReportsMigration } = require('../database/migrations/011_message_reports');

jest.setTimeout(30000);

describe('Admin dashboard RBAC and endpoints', () => {
  const stamp = Date.now();
  const password = 'password123';

  const accounts = {};
  const counters = { n: 0 };

  async function createAccount(role) {
    counters.n += 1;
    const suffix = `${stamp}${counters.n}`;
    const email = `admin${role}${suffix}@example.com`;
    const username = `adm${role}${counters.n}${suffix.toString().slice(-6)}`;

    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        full_name: `Admin ${role}`,
        username,
        email,
        password,
      });
    expect(reg.statusCode).toBe(201);

    await execute('UPDATE users SET role = ? WHERE id = ?', [role, reg.body.data.user.id]);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    expect(login.statusCode).toBe(200);

    return {
      id: reg.body.data.user.id,
      email,
      username,
      token: login.body.data.token,
      role: login.body.data.user.role,
    };
  }

  beforeAll(async () => {
    await runRbacMigration();
    await runModerationMigration();
    await runMessageReportsMigration();

    accounts.regular = await createAccount('user');
    accounts.moderator = await createAccount('moderator');
    accounts.support = await createAccount('support');
    accounts.admin = await createAccount('admin');
    accounts.super = await createAccount('super_admin');
  });

  describe('Authentication and role gating', () => {
    test('admin endpoints require a token', async () => {
      const res = await request(app).get('/api/admin/overview');
      expect(res.statusCode).toBe(401);
    });

    test('regular users cannot access the admin API', async () => {
      const res = await request(app)
        .get('/api/admin/overview')
        .set('Authorization', `Bearer ${accounts.regular.token}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    test('regular users cannot list users or reports', async () => {
      const users = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${accounts.regular.token}`);
      expect(users.statusCode).toBe(403);

      const reports = await request(app)
        .get('/api/admin/reports')
        .set('Authorization', `Bearer ${accounts.regular.token}`);
      expect(reports.statusCode).toBe(403);
    });

    test('denied attempts are recorded in the audit log', async () => {
      const res = await request(app)
        .get('/api/admin/overview?action=ignored')
        .set('Authorization', `Bearer ${accounts.regular.token}`);
      expect(res.statusCode).toBe(403);

      const rows = await query(
        `SELECT id FROM admin_audit_logs WHERE action = 'auth.denied' AND actor_username = ?
         ORDER BY id DESC LIMIT 1`,
        [accounts.regular.username]
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    test('login responses include the role', () => {
      expect(accounts.admin.role).toBe('admin');
      expect(accounts.super.role).toBe('super_admin');
      expect(accounts.regular.role).toBe('user');
    });
  });

  describe('Overview and user management permissions', () => {
    test('admins can load the overview with real stats', async () => {
      const res = await request(app)
        .get('/api/admin/overview')
        .set('Authorization', `Bearer ${accounts.admin.token}`);
      expect(res.statusCode).toBe(200);
      const { stats, trends, metricDefinitions } = res.body.data;
      expect(typeof stats.totalUsers).toBe('number');
      expect(stats.totalUsers).toBeGreaterThanOrEqual(5);
      expect(typeof stats.pendingReports).toBe('number');
      expect(Array.isArray(trends.registrations)).toBe(true);
      expect(metricDefinitions.active_users_7d).toBeDefined();
    });

    test('support can read users but cannot suspend them', async () => {
      const list = await request(app)
        .get('/api/admin/users?limit=5')
        .set('Authorization', `Bearer ${accounts.support.token}`);
      expect(list.statusCode).toBe(200);
      expect(Array.isArray(list.body.data.users)).toBe(true);
      expect(list.body.data.pagination).toHaveProperty('total');

      const suspend = await request(app)
        .patch(`/api/admin/users/${accounts.regular.id}/status`)
        .set('Authorization', `Bearer ${accounts.support.token}`)
        .send({ is_active: false });
      expect(suspend.statusCode).toBe(403);
    });

    test('admins cannot suspend accounts that outrank them', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${accounts.super.id}/status`)
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ is_active: false });
      expect(res.statusCode).toBe(403);
    });

    test('admins can suspend and reactivate regular accounts', async () => {
      const suspend = await request(app)
        .patch(`/api/admin/users/${accounts.regular.id}/status`)
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ is_active: false, reason: 'rbac test' });
      expect(suspend.statusCode).toBe(200);

      const blocked = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accounts.regular.token}`);
      expect(blocked.statusCode).toBe(401);

      const restore = await request(app)
        .patch(`/api/admin/users/${accounts.regular.id}/status`)
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ is_active: true });
      expect(restore.statusCode).toBe(200);

      const allowed = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accounts.regular.token}`);
      expect(allowed.statusCode).toBe(200);
    });

    test('nobody can modify their own account status', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${accounts.admin.id}/status`)
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ is_active: false });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Role assignment rules', () => {
    test('admins cannot grant the admin role', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${accounts.regular.id}/role`)
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ role: 'admin' });
      expect(res.statusCode).toBe(403);
    });

    test('admins can grant the moderator role', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${accounts.regular.id}/role`)
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ role: 'moderator' });
      expect(res.statusCode).toBe(200);

      const check = await query('SELECT role FROM users WHERE id = ?', [accounts.regular.id]);
      expect(check[0].role).toBe('moderator');
    });

    test('super admins can grant the admin role and revert it', async () => {
      const grant = await request(app)
        .patch(`/api/admin/users/${accounts.regular.id}/role`)
        .set('Authorization', `Bearer ${accounts.super.token}`)
        .send({ role: 'admin' });
      expect(grant.statusCode).toBe(200);

      const revert = await request(app)
        .patch(`/api/admin/users/${accounts.regular.id}/role`)
        .set('Authorization', `Bearer ${accounts.super.token}`)
        .send({ role: 'user' });
      expect(revert.statusCode).toBe(200);
    });

    test('nobody can change their own role', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${accounts.super.id}/role`)
        .set('Authorization', `Bearer ${accounts.super.token}`)
        .send({ role: 'user' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Reports moderation workflow', () => {
    let reportId;

    beforeAll(async () => {
      await execute(
        `INSERT INTO user_reports (reporter_id, reported_id, reason, status)
         VALUES (?, ?, ?, 'open')`,
        [accounts.regular.id, accounts.moderator.id, 'automated rbac test report']
      );
      const rows = await query(
        `SELECT id FROM user_reports WHERE reporter_id = ? ORDER BY id DESC LIMIT 1`,
        [accounts.regular.id]
      );
      reportId = rows[0].id;
    });

    test('support can read reports but not change them', async () => {
      const list = await request(app)
        .get('/api/admin/reports?type=user')
        .set('Authorization', `Bearer ${accounts.support.token}`);
      expect(list.statusCode).toBe(200);
      expect(list.body.data.reports.length).toBeGreaterThan(0);
      expect(list.body.data.reports[0]).toHaveProperty('type', 'user');

      const update = await request(app)
        .patch(`/api/admin/reports/user/${reportId}/status`)
        .set('Authorization', `Bearer ${accounts.support.token}`)
        .send({ status: 'reviewed' });
      expect(update.statusCode).toBe(403);
    });

    test('moderators can review, note and resolve reports', async () => {
      const review = await request(app)
        .patch(`/api/admin/reports/user/${reportId}/status`)
        .set('Authorization', `Bearer ${accounts.moderator.token}`)
        .send({ status: 'reviewed', note: 'looking into it' });
      expect(review.statusCode).toBe(200);
      expect(review.body.data.status).toBe('reviewed');

      const note = await request(app)
        .post(`/api/admin/reports/user/${reportId}/notes`)
        .set('Authorization', `Bearer ${accounts.moderator.token}`)
        .send({ note: 'internal note' });
      expect(note.statusCode).toBe(201);

      const detail = await request(app)
        .get(`/api/admin/reports/user/${reportId}`)
        .set('Authorization', `Bearer ${accounts.moderator.token}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.body.data.report.status).toBe('reviewed');
      expect(detail.body.data.notes.length).toBeGreaterThan(0);

      const resolve = await request(app)
        .patch(`/api/admin/reports/user/${reportId}/status`)
        .set('Authorization', `Bearer ${accounts.moderator.token}`)
        .send({ status: 'resolved', note: 'no action needed' });
      expect(resolve.statusCode).toBe(200);
      expect(resolve.body.data.status).toBe('resolved');
    });

    test('invalid report types are rejected', async () => {
      const res = await request(app)
        .get('/api/admin/reports/banana/1')
        .set('Authorization', `Bearer ${accounts.admin.token}`);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Content moderation and analytics access', () => {
    let postId;

    beforeAll(async () => {
      await execute(
        `INSERT INTO posts (user_id, caption, media_type, media_url, audience)
         VALUES (?, 'hidden for moderation test', 'image', 'https://example.com/x.jpg', 'public')`,
        [accounts.regular.id]
      );
      const rows = await query(
        'SELECT id FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [accounts.regular.id]
      );
      postId = rows[0].id;
    });

    test('admins can hide and restore posts, and hidden posts leave the feed', async () => {
      const hide = await request(app)
        .patch(`/api/admin/posts/${postId}/hide`)
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ reason: 'policy violation' });
      expect(hide.statusCode).toBe(200);

      const detail = await request(app)
        .get(`/api/admin/posts?q=hidden for moderation`)
        .set('Authorization', `Bearer ${accounts.admin.token}`);
      expect(detail.statusCode).toBe(200);
      const hidden = detail.body.data.posts.find((p) => p.id === postId);
      expect(hidden.is_hidden).toBe(1);

      const feed = await request(app).get('/api/posts');
      expect(feed.statusCode).toBe(200);
      const inFeed = feed.body.data.posts.find((p) => p.id === postId);
      expect(inFeed).toBeUndefined();

      const restore = await request(app)
        .patch(`/api/admin/posts/${postId}/restore`)
        .set('Authorization', `Bearer ${accounts.admin.token}`);
      expect(restore.statusCode).toBe(200);

      const feedAgain = await request(app).get('/api/posts');
      expect(feedAgain.body.data.posts.find((p) => p.id === postId)).toBeDefined();
    });

    test('moderators cannot read analytics; admins can', async () => {
      const modRes = await request(app)
        .get('/api/admin/analytics')
        .set('Authorization', `Bearer ${accounts.moderator.token}`);
      expect(modRes.statusCode).toBe(403);

      const adminRes = await request(app)
        .get('/api/admin/analytics?from=2023-01-01&to=2023-12-31')
        .set('Authorization', `Bearer ${accounts.admin.token}`);
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.body.data).toHaveProperty('series');
      expect(adminRes.body.data).toHaveProperty('kpi');
    });

    test('analytics exports return CSV', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/export?report=users')
        .set('Authorization', `Bearer ${accounts.admin.token}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.split('\n')[0]).toContain('username');
    });
  });

  describe('Settings and audit log', () => {
    test('public settings are exposed without auth', async () => {
      const res = await request(app).get('/api/settings');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.settings).toHaveProperty('site_name');
      expect(res.body.data.settings).not.toHaveProperty('maintenance_mode');
    });

    test('admins can update non-sensitive settings', async () => {
      const put = await request(app)
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ site_tagline: 'RBAC test tagline' });
      expect(put.statusCode).toBe(200);
      expect(put.body.data.settings.site_tagline).toBe('RBAC test tagline');

      const restore = await request(app)
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ site_tagline: '' });
      expect(restore.statusCode).toBe(200);
    });

    test('only super admins can change sensitive settings', async () => {
      const adminTry = await request(app)
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${accounts.admin.token}`)
        .send({ maintenance_mode: 'true' });
      expect(adminTry.statusCode).toBe(403);

      const superTry = await request(app)
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${accounts.super.token}`)
        .send({ registration_enabled: 'true' });
      expect(superTry.statusCode).toBe(200);
    });

    test('audit logs are readable by admins and include moderation actions', async () => {
      const res = await request(app)
        .get('/api/admin/audit?action=user&limit=10')
        .set('Authorization', `Bearer ${accounts.admin.token}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data.logs)).toBe(true);

      const suspensions = await query(
        `SELECT id FROM admin_audit_logs WHERE action = 'user.suspend' ORDER BY id DESC LIMIT 1`
      );
      expect(suspensions.length).toBeGreaterThan(0);
    });

    test('support cannot read audit logs', async () => {
      const res = await request(app)
        .get('/api/admin/audit')
        .set('Authorization', `Bearer ${accounts.support.token}`);
      expect(res.statusCode).toBe(403);
    });
  });
});
