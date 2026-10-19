const mockQuery = jest.fn();

const { tableExists, addColumnsIfMissing } = require('../database/migrations/helpers');

function connection() {
  return { query: mockQuery };
}

function schema({ tables = [], columns = {} }) {
  mockQuery.mockImplementation((sql, params) => {
    if (sql.includes('information_schema.TABLES')) {
      const [table] = params;
      return Promise.resolve([tables.includes(table) ? [{ present: 1 }] : []]);
    }
    if (sql.includes('information_schema.COLUMNS')) {
      const [table] = params;
      return Promise.resolve([(columns[table] || []).map((COLUMN_NAME) => ({ COLUMN_NAME }))]);
    }
    return Promise.resolve([{}]);
  });
}

describe('migration column helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('tableExists reflects information_schema.TABLES', async () => {
    schema({ tables: ['users'] });

    await expect(tableExists(connection(), 'users')).resolves.toBe(true);
    await expect(tableExists(connection(), 'statuses')).resolves.toBe(false);
  });

  test('adds only missing columns in a single ALTER statement', async () => {
    schema({ tables: ['users'], columns: { users: ['interests'] } });

    await addColumnsIfMissing(connection(), 'users', {
      interests: 'VARCHAR(500) NULL',
      who_can_message: "ENUM('everyone', 'connections') NOT NULL DEFAULT 'everyone'",
      show_online: 'TINYINT(1) NOT NULL DEFAULT 1',
    });

    const alter = mockQuery.mock.calls.find(([sql]) => sql.startsWith('ALTER TABLE'));
    expect(alter).toBeDefined();
    expect(alter[0]).toContain('ADD COLUMN `who_can_message`');
    expect(alter[0]).toContain('ADD COLUMN `show_online`');
    expect(alter[0]).not.toContain('ADD COLUMN `interests`');
    expect(alter[0]).not.toContain('IF NOT EXISTS');
  });

  test('does nothing when every column already exists', async () => {
    schema({ tables: ['users'], columns: { users: ['interests', 'show_online'] } });

    await addColumnsIfMissing(connection(), 'users', {
      interests: 'VARCHAR(500) NULL',
      show_online: 'TINYINT(1) NOT NULL DEFAULT 1',
    });

    expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('ALTER TABLE'))).toBe(false);
  });

  test('skips entirely when the target table does not exist', async () => {
    schema({ tables: [] });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await addColumnsIfMissing(connection(), 'statuses', { upload_id: 'VARCHAR(100) NULL' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("Skipping column migration: table 'statuses' does not exist");
    } finally {
      warn.mockRestore();
    }
  });
});
