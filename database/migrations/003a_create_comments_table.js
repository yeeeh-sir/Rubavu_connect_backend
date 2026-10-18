const { pool } = require('../../config/database');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    const [parents] = await connection.execute(
      `SELECT t.TABLE_NAME, t.ENGINE, c.COLUMN_TYPE, c.COLUMN_KEY
       FROM information_schema.TABLES t
       JOIN information_schema.COLUMNS c
         ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
         AND c.TABLE_NAME = t.TABLE_NAME
         AND c.COLUMN_NAME = 'id'
       WHERE t.TABLE_SCHEMA = DATABASE()
         AND t.TABLE_NAME IN (?, ?)`,
      ['posts', 'users']
    );
    for (const tableName of ['posts', 'users']) {
      const parent = parents.find((table) => table.TABLE_NAME === tableName);
      if (
        !parent ||
        parent.ENGINE !== 'InnoDB' ||
        !/^bigint(?:\(\d+\))? unsigned$/i.test(parent.COLUMN_TYPE) ||
        parent.COLUMN_KEY !== 'PRI'
      ) {
        throw new Error(
          `Cannot create comments table: ${tableName}.id must be an InnoDB BIGINT UNSIGNED primary key`
        );
      }
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        post_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        comment_text TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_comments_post (post_id),
        KEY idx_comments_user (user_id),
        CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('Comments schema migration complete');
  } catch (error) {
    console.error('Comments table migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
