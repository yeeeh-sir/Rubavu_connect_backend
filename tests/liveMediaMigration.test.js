const mockGetConnection = jest.fn();
const mockQuery = jest.fn();
const mockExecute = jest.fn();
const mockRelease = jest.fn();

jest.mock('../config/database', () => ({
  pool: {
    getConnection: mockGetConnection,
  },
}));

const { runMigration } = require('../database/migrations/004_create_live_and_comment_media');

describe('live and comment media migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue({
      query: mockQuery,
      execute: mockExecute,
      release: mockRelease,
    });
    mockQuery.mockResolvedValue([{}]);
  });

  test('adds only missing comment media columns using MariaDB-compatible DDL', async () => {
    mockExecute.mockResolvedValue([[
      { COLUMN_NAME: 'media_type' },
    ]]);

    await runMigration();

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('information_schema.COLUMNS'),
      ['media_url', 'media_type', 'audio_duration']
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('MODIFY COLUMN comment_text TEXT NULL')
    );
    expect(mockQuery).toHaveBeenCalledWith(
      'ALTER TABLE comments ADD COLUMN `media_url` VARCHAR(1000) NULL'
    );
    expect(mockQuery).toHaveBeenCalledWith(
      'ALTER TABLE comments ADD COLUMN `audio_duration` DECIMAL(8,2) NULL'
    );
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('ADD COLUMN IF NOT EXISTS'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('does not re-add media columns that already exist', async () => {
    mockExecute.mockResolvedValue([[
      { COLUMN_NAME: 'media_url' },
      { COLUMN_NAME: 'media_type' },
      { COLUMN_NAME: 'audio_duration' },
    ]]);

    await runMigration();

    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('ADD COLUMN `media_url`'))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('ADD COLUMN `media_type`'))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('ADD COLUMN `audio_duration`'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
