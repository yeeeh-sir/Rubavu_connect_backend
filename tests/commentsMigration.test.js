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

  test('matches the verified posts and users BIGINT UNSIGNED primary-key schema', async () => {
    mockExecute.mockResolvedValue([[
      {
        TABLE_NAME: 'posts',
        ENGINE: 'InnoDB',
        COLUMN_TYPE: 'bigint(20) unsigned',
        PRIMARY_KEY_COLUMN_COUNT: 1,
        ID_IS_PRIMARY_KEY: 1,
      },
      {
        TABLE_NAME: 'users',
        ENGINE: 'InnoDB',
        COLUMN_TYPE: 'bigint(20) unsigned',
        PRIMARY_KEY_COLUMN_COUNT: 1,
        ID_IS_PRIMARY_KEY: 1,
      },
    ]]);

    await runMigration();

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('information_schema.TABLES'), ['posts', 'users']);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS comments'));
    const createTable = mockQuery.mock.calls[0][0];
    expect(createTable).toContain('post_id BIGINT(20) UNSIGNED NOT NULL');
    expect(createTable).toContain('user_id BIGINT(20) UNSIGNED NOT NULL');
    expect(createTable).toContain('REFERENCES posts(id)');
    expect(createTable).toContain('REFERENCES users(id)');
    expect(createTable).toContain('comment_text TEXT NULL');
    expect(createTable).toContain('ENGINE=InnoDB');
    expect(createTable).not.toContain('DROP TABLE');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('continues to match verified signed integer parent schemas when present', async () => {
    mockExecute.mockResolvedValue([[
      {
        TABLE_NAME: 'posts',
        ENGINE: 'InnoDB',
        COLUMN_TYPE: 'int(11)',
        PRIMARY_KEY_COLUMN_COUNT: 1,
        ID_IS_PRIMARY_KEY: 1,
      },
      {
        TABLE_NAME: 'users',
        ENGINE: 'InnoDB',
        COLUMN_TYPE: 'bigint(20) unsigned',
        PRIMARY_KEY_COLUMN_COUNT: 1,
        ID_IS_PRIMARY_KEY: 1,
      },
    ]]);

    await runMigration();

    expect(mockQuery.mock.calls[0][0]).toContain('post_id INT(11) NOT NULL');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('uses idempotent DDL when run repeatedly', async () => {
    mockExecute.mockResolvedValue([[
      {
        TABLE_NAME: 'posts',
        ENGINE: 'InnoDB',
        COLUMN_TYPE: 'bigint(20) unsigned',
        PRIMARY_KEY_COLUMN_COUNT: 1,
        ID_IS_PRIMARY_KEY: 1,
      },
      {
        TABLE_NAME: 'users',
        ENGINE: 'InnoDB',
        COLUMN_TYPE: 'bigint(20) unsigned',
        PRIMARY_KEY_COLUMN_COUNT: 1,
        ID_IS_PRIMARY_KEY: 1,
      },
    ]]);

    await runMigration();
    await runMigration();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls.every(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS comments'))).toBe(true);
  });

  test('reports when posts is missing from the selected schema but exists elsewhere', async () => {
    mockExecute
      .mockResolvedValueOnce([[
        {
          TABLE_NAME: 'users',
          ENGINE: 'InnoDB',
          COLUMN_TYPE: 'bigint(20) unsigned',
          PRIMARY_KEY_COLUMN_COUNT: 1,
          ID_IS_PRIMARY_KEY: 1,
        },
      ]])
      .mockResolvedValueOnce([[
        {
          DATABASE_NAME: 'rubavu_connect',
          TABLE_NAME: null,
          ENGINE: null,
          COLUMN_NAME: null,
          COLUMN_TYPE: null,
          IS_NULLABLE: null,
          COLUMN_KEY: null,
          EXTRA: null,
          PRIMARY_KEY_COLUMN_COUNT: 0,
          PRIMARY_KEY_COLUMNS: null,
          POSTS_IN_OTHER_SCHEMAS: 1,
        },
      ]]);
    const diagnosticLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(runMigration()).rejects.toThrow('Cannot create comments table: posts.id');
      expect(mockExecute).toHaveBeenLastCalledWith(expect.stringContaining('SELECT DATABASE()'));
      expect(mockExecute.mock.calls[1][0]).toContain('information_schema.COLUMNS');
      expect(mockExecute.mock.calls[1][0]).toContain('information_schema.KEY_COLUMN_USAGE');
      expect(diagnosticLog).toHaveBeenCalledWith(
        'Read-only posts schema diagnostics:',
        JSON.stringify({
          database: 'rubavu_connect',
          postsExists: false,
          postsExistsInOtherSchema: true,
          engine: null,
          primaryKeyColumnCount: 0,
          primaryKeyColumns: [],
          columns: [],
        })
      );
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockRelease).toHaveBeenCalledTimes(1);
    } finally {
      diagnosticLog.mockRestore();
    }
  });
});
