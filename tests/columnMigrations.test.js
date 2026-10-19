const mockGetConnection = jest.fn();
const mockQuery = jest.fn();
const mockExecute = jest.fn();
const mockRelease = jest.fn();

jest.mock('../config/database', () => ({
  pool: { getConnection: mockGetConnection },
}));

const posts = require('../database/migrations/003_create_posts_table');
const audience = require('../database/migrations/005_add_post_audience_collaborators');
const platform = require('../database/migrations/006_create_platform_features');
const presence = require('../database/migrations/007_add_presence');
const phone = require('../database/migrations/008_add_phone_number');
const moderation = require('../database/migrations/010_moderation_fields');

const ALL_TABLES = [
  'users', 'posts', 'notifications', 'connections', 'comments', 'live_sessions',
  'post_collaborators', 'statuses', 'post_media', 'post_reports', 'comment_reports',
  'user_reports', 'live_reports',
];

function installSchema({ tables = ALL_TABLES, columns = {}, noteTables = [] } = {}) {
  mockQuery.mockImplementation((sql, params) => {
    if (sql.includes('information_schema.TABLES')) {
      const [table] = params;
      return Promise.resolve([tables.includes(table) ? [{ present: 1 }] : []]);
    }
    if (sql.includes('SELECT COLUMN_NAME FROM information_schema.COLUMNS')) {
      const [table] = params;
      return Promise.resolve([(columns[table] || []).map((COLUMN_NAME) => ({ COLUMN_NAME }))]);
    }
    if (sql.includes('COLUMN_TYPE AS ct')) {
      return Promise.resolve([[]]);
    }
    if (sql.includes("SHOW TABLES LIKE 'report_notes'")) {
      return Promise.resolve([noteTables]);
    }
    if (sql.includes('SHOW INDEX FROM users')) {
      return Promise.resolve([[]]);
    }
    return Promise.resolve([{}]);
  });
}

function alterCalls() {
  return mockQuery.mock.calls.filter(([sql]) => sql.startsWith('ALTER TABLE')).map(([sql]) => sql);
}

describe('MySQL-compatible column migrations (Aiven)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue({
      query: mockQuery,
      execute: mockExecute,
      release: mockRelease,
    });
    mockExecute.mockResolvedValue([[]]);
    installSchema({ columns: { users: ['interests', 'who_can_message', 'who_can_connect', 'show_online', 'last_active_at', 'phone_number'] } });
  });

  test('no migration emits unsupported ADD COLUMN IF NOT EXISTS syntax', async () => {
    await posts.runMigration();
    await audience.runMigration();
    await platform.runMigration();
    await presence.runMigration();
    await phone.runMigration();
    await moderation.runMigration();

    const ddl = mockQuery.mock.calls.map(([sql]) => sql);
    expect(ddl.some((sql) => sql.includes('ADD COLUMN IF NOT EXISTS'))).toBe(false);
  });

  test('posts audience migration adds audience and creates collaborators idempotently', async () => {
    await audience.runMigration();

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS post_collaborators'));
    const alter = alterCalls().find((sql) => sql.includes('`posts`'));
    expect(alter).toContain('ADD COLUMN `audience`');
    expect(alter).not.toContain('IF NOT EXISTS');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('platform features adds guarded columns and keeps table creation', async () => {
    await platform.runMigration();

    const sqls = mockQuery.mock.calls.map(([sql]) => sql);
    for (const table of ['post_media', 'post_reports', 'comment_reports', 'live_reports']) {
      expect(sqls.some((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`))).toBe(true);
    }
    const alters = alterCalls();
    expect(alters.some((sql) => sql.includes('`post_collaborators`') && sql.includes('ADD COLUMN `status`'))).toBe(true);
    expect(alters.some((sql) => sql.includes('`live_sessions`') && sql.includes('ADD COLUMN `created_by`'))).toBe(true);
    expect(alters.some((sql) => sql.includes('`statuses`') && sql.includes('ADD COLUMN `upload_id`'))).toBe(true);
    expect(sqls.some((sql) => sql.includes('MODIFY COLUMN type'))).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('platform features skips columns that already exist', async () => {
    installSchema({ columns: { users: ['interests', 'who_can_message', 'who_can_connect', 'show_online'] } });
    await platform.runMigration();

    expect(alterCalls().some((sql) => sql.includes('ALTER TABLE `users`'))).toBe(false);
  });

  test('presence migration adds last_active_at with ordering', async () => {
    installSchema({ columns: { users: [] } });
    await presence.runMigration();

    const alter = alterCalls()[0];
    expect(alter).toContain('ADD COLUMN `last_active_at` DATETIME NULL AFTER show_online');
    expect(alter).not.toContain('IF NOT EXISTS');
  });

  test('phone migration adds phone_number and unique index once', async () => {
    installSchema({ columns: { users: [] } });
    await phone.runMigration();

    const alters = alterCalls();
    expect(alters.some((sql) => sql.includes('ADD COLUMN `phone_number` VARCHAR(32) NULL'))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('CREATE UNIQUE INDEX uq_users_phone_number'))).toBe(true);
  });

  test('moderation migration guards report/posts columns and widens status enum', async () => {
    installSchema({ columns: {} });
    await moderation.runMigration();

    const alters = alterCalls();
    for (const table of ['post_reports', 'comment_reports', 'user_reports', 'live_reports']) {
      expect(alters.some((sql) => sql.includes(`\`${table}\``) && sql.includes('ADD COLUMN `assigned_to`'))).toBe(true);
    }
    expect(alters.some((sql) => sql.includes('`posts`') && sql.includes('ADD COLUMN `is_hidden`'))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('CREATE TABLE report_notes'))).toBe(true);
  });
});
