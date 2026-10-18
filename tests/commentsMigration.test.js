const mockGetConnection = jest.fn();
const mockExecute = jest.fn();
const mockQuery = jest.fn();
const mockRelease = jest.fn();

jest.mock('../config/database', () => ({
  pool: { getConnection: mockGetConnection },
}));

const { runMigration } = require('../database/migrations/003a_create_comments_table');
const { migrationNames } = require('../database/runMigrations');

describe('comments table migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue({
      execute: mockExecute,
      query: mockQuery,
      release: mockRelease,
    });
  });

  test('preserves every migration in order and places comments before comment media', () => {
    expect(migrationNames).toEqual([
      'users',
      'notifications',
      'connections',
      'safety',
      'comments',
      'live and comment media',
      'post audience',
      'platform features',
      'presence',
      'phone number',
      'RBAC',
      'moderation',
      'message reports',
    ]);
  });

  test('creates the application comments schema only after validating its existing parent tables', async () => {
    mockExecute.mockResolvedValue([[
      { TABLE_NAME: 'posts', ENGINE: 'InnoDB', COLUMN_TYPE: 'bigint(20) unsigned', COLUMN_KEY: 'PRI' },
      { TABLE_NAME: 'users', ENGINE: 'InnoDB', COLUMN_TYPE: 'bigint(20) unsigned', COLUMN_KEY: 'PRI' },
    ]]);

    await runMigration();

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('information_schema.TABLES'), ['posts', 'users']);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS comments'));
    const createTable = mockQuery.mock.calls[0][0];
    expect(createTable).toContain('post_id BIGINT UNSIGNED NOT NULL');
    expect(createTable).toContain('user_id BIGINT UNSIGNED NOT NULL');
    expect(createTable).toContain('REFERENCES posts(id)');
    expect(createTable).toContain('REFERENCES users(id)');
    expect(createTable).toContain('comment_text TEXT NULL');
    expect(createTable).toContain('ENGINE=InnoDB');
    expect(createTable).not.toContain('DROP TABLE');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('uses idempotent DDL when run repeatedly', async () => {
    mockExecute.mockResolvedValue([[
      { TABLE_NAME: 'posts', ENGINE: 'InnoDB', COLUMN_TYPE: 'bigint(20) unsigned', COLUMN_KEY: 'PRI' },
      { TABLE_NAME: 'users', ENGINE: 'InnoDB', COLUMN_TYPE: 'bigint(20) unsigned', COLUMN_KEY: 'PRI' },
    ]]);

    await runMigration();
    await runMigration();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls.every(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS comments'))).toBe(true);
  });

  test('fails clearly without creating a table if a required parent table is missing', async () => {
    mockExecute.mockResolvedValue([[
      { TABLE_NAME: 'users', ENGINE: 'InnoDB', COLUMN_TYPE: 'bigint(20) unsigned', COLUMN_KEY: 'PRI' },
    ]]);

    await expect(runMigration()).rejects.toThrow(
      'Cannot create comments table: posts.id must be an InnoDB BIGINT UNSIGNED primary key'
    );
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
