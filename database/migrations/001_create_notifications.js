const { pool } = require('../../config/database');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        from_user_id BIGINT UNSIGNED NOT NULL,
        type ENUM('follow', 'like', 'comment', 'message') NOT NULL,
        post_id INT DEFAULT NULL,
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_notifications_user (user_id),
        INDEX idx_notifications_unread (user_id, is_read)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Notifications table migration complete');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
