const { pool } = require('../../config/database');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_blocks (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        blocker_id BIGINT UNSIGNED NOT NULL,
        blocked_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_block (blocker_id, blocked_id),
        INDEX idx_user_blocks_blocked (blocked_id),
        CONSTRAINT fk_user_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_user_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_reports (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        reporter_id BIGINT UNSIGNED NOT NULL,
        reported_id BIGINT UNSIGNED NOT NULL,
        reason VARCHAR(500) NOT NULL,
        status ENUM('open', 'reviewed', 'resolved') NOT NULL DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_reports_status (status, created_at),
        CONSTRAINT fk_user_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_user_reports_reported FOREIGN KEY (reported_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Safety migration complete');
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
