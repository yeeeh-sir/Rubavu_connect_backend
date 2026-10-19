const mockGetConnection = jest.fn();
const mockQuery = jest.fn();
const mockRelease = jest.fn();

jest.mock('../config/database', () => ({
  pool: { getConnection: mockGetConnection },
}));

const follows = require('../database/migrations/002a_create_follows_table');
const statuses = require('../database/migrations/002b_create_statuses_table');
const messages = require('../database/migrations/002c_create_messages_table');
const postLikes = require('../database/migrations/003b_create_post_likes_table');

const missing = {
  follows: {
    runMigration: follows.runMigration,
    table: 'follows',
    required: [
      'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
      'follower_id BIGINT UNSIGNED NOT NULL',
      'following_id BIGINT UNSIGNED NOT NULL',
      'UNIQUE KEY uq_follows_pair (follower_id, following_id)',
      'REFERENCES users(id) ON DELETE CASCADE',
    ],
  },
  statuses: {
    runMigration: statuses.runMigration,
    table: 'statuses',
    required: [
      'user_id BIGINT UNSIGNED NOT NULL',
      "media_type ENUM('image', 'video') NOT NULL",
      'media_url TEXT NOT NULL',
      'expires_at DATETIME NOT NULL',
      'upload_id VARCHAR(100) NULL',
      'REFERENCES users(id) ON DELETE CASCADE',
    ],
  },
  messages: {
    runMigration: messages.runMigration,
    table: 'messages',
    required: [
      'sender_id BIGINT UNSIGNED NOT NULL',
      'receiver_id BIGINT UNSIGNED NOT NULL',
      "message_type ENUM('text', 'image', 'voice') NOT NULL",
      'is_read TINYINT(1) DEFAULT 0',
      'REFERENCES users(id) ON DELETE CASCADE',
    ],
  },
  'post_likes': {
    runMigration: postLikes.runMigration,
    table: 'post_likes',
    required: [
      'post_id BIGINT UNSIGNED NOT NULL',
      'user_id BIGINT UNSIGNED NOT NULL',
      'UNIQUE KEY uq_post_likes_pair (post_id, user_id)',
      'REFERENCES posts(id) ON DELETE CASCADE',
      'REFERENCES users(id) ON DELETE CASCADE',
    ],
  },
};

describe('missing core table migrations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockQuery.mockResolvedValue([{}]);
  });

  test.each(Object.entries(missing))('%s creates the verified table idempotently', async (name, spec) => {
    await spec.runMigration();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${spec.table}`);
    expect(sql).toContain('ENGINE=InnoDB');
    for (const fragment of spec.required) {
      expect(sql).toContain(fragment);
    }
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('every new table migration is idempotent across repeated runs', async () => {
    for (const spec of Object.values(missing)) {
      await spec.runMigration();
      await spec.runMigration();
    }

    expect(mockQuery.mock.calls.every(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS'))).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(8);
  });
});
