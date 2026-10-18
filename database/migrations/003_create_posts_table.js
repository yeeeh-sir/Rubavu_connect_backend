const { pool } = require('../../config/database');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        caption TEXT NULL,
        media_type ENUM('image', 'video') NOT NULL,
        media_url TEXT NOT NULL,
        thumbnail_url TEXT NULL,
        video_duration DECIMAL(6,2) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        audience ENUM('public', 'friends', 'private') NOT NULL DEFAULT 'public',
        is_hidden TINYINT(1) NOT NULL DEFAULT 0,
        hidden_reason VARCHAR(500) NULL,
        hidden_by BIGINT UNSIGNED NULL,
        hidden_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_posts_user (user_id),
        KEY idx_posts_created (created_at),
        CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('Posts schema migration complete');
  } catch (error) {
    console.error('Posts table migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
