const mockGetConnection = jest.fn();
const mockQuery = jest.fn();
const mockExecute = jest.fn();
const mockRelease = jest.fn();

jest.mock('../config/database', () => ({
  pool: {
    getConnection: mockGetConnection,
  },
}));

const { runMigration } = require('../database/migrations/000_create_users');

describe('users schema migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue({
      query: mockQuery,
      execute: mockExecute,
      release: mockRelease,
    });
    mockQuery.mockResolvedValue([{}]);
    mockExecute.mockResolvedValue([[
      {
        COLUMN_TYPE: 'bigint(20) unsigned',
        COLUMN_KEY: 'PRI',
        ENGINE: 'InnoDB',
      },
    ]]);
  });

  test('creates the registered users table idempotently and validates its FK target key', async () => {
    await runMigration();

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS users'));
    expect(mockQuery.mock.calls[0][0]).toContain('id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(mockQuery.mock.calls[0][0]).toContain('ENGINE=InnoDB');
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('information_schema.COLUMNS'));
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('fails clearly and releases the connection when an existing users key is incompatible', async () => {
    mockExecute.mockResolvedValue([[
      {
        COLUMN_TYPE: 'int(11)',
        COLUMN_KEY: 'PRI',
        ENGINE: 'InnoDB',
      },
    ]]);

    await expect(runMigration()).rejects.toThrow(
      'The users table must use an InnoDB BIGINT UNSIGNED primary key named id'
    );
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
