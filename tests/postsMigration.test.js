const mockGetConnection = jest.fn();
const mockQuery = jest.fn();
const mockRelease = jest.fn();

jest.mock('../config/database', () => ({
  pool: { getConnection: mockGetConnection },
}));

const { runMigration } = require('../database/migrations/003_create_posts_table');

describe('posts table migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
    mockQuery.mockResolvedValue([{}]);
  });

  test('creates the verified MySQL posts schema without replacing existing data', async () => {
    await runMigration();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const createTable = mockQuery.mock.calls[0][0];
    expect(createTable).toContain('CREATE TABLE IF NOT EXISTS posts');
    expect(createTable).toContain('id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(createTable).toContain('user_id BIGINT UNSIGNED NOT NULL');
    expect(createTable).toContain('caption TEXT NULL');
    expect(createTable).toContain('media_type ENUM(\'image\', \'video\') NOT NULL');
    expect(createTable).toContain('media_url TEXT NOT NULL');
    expect(createTable).toContain('thumbnail_url TEXT NULL');
    expect(createTable).toContain('video_duration DECIMAL(6,2) NULL');
    expect(createTable).toContain('created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(createTable).toContain("audience ENUM('public', 'friends', 'private') NOT NULL DEFAULT 'public'");
    expect(createTable).toContain('is_hidden TINYINT(1) NOT NULL DEFAULT 0');
    expect(createTable).toContain('hidden_reason VARCHAR(500) NULL');
    expect(createTable).toContain('hidden_by BIGINT UNSIGNED NULL');
    expect(createTable).toContain('hidden_at TIMESTAMP NULL DEFAULT NULL');
    expect(createTable).toContain('PRIMARY KEY (id)');
    expect(createTable).toContain('KEY idx_posts_user (user_id)');
    expect(createTable).toContain('KEY idx_posts_created (created_at)');
    expect(createTable).toContain('REFERENCES users(id) ON DELETE CASCADE');
    expect(createTable).toContain('ENGINE=InnoDB');
    expect(createTable).not.toContain('DROP TABLE');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('uses idempotent DDL on repeated startup', async () => {
    await runMigration();
    await runMigration();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls.every(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS posts'))).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  test('releases the connection and propagates table-creation errors', async () => {
    const migrationError = new Error('Database rejected posts table creation');
    mockQuery.mockRejectedValueOnce(migrationError);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(runMigration()).rejects.toBe(migrationError);
      expect(errorLog).toHaveBeenCalledWith('Posts table migration failed:', migrationError.message);
      expect(mockRelease).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
    }
  });
});
