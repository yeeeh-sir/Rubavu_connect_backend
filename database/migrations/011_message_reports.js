const { pool } = require('../../config/database');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query(
      "SHOW TABLES LIKE 'message_reports'"
    );
    if (tables.length === 0) {
      await connection.query(`
        CREATE TABLE message_reports (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          reporter_id BIGINT UNSIGNED NOT NULL,
          message_id BIGINT UNSIGNED NOT NULL,
          reason VARCHAR(500) NOT NULL,
          status ENUM('open','reviewed','resolved','dismissed') NOT NULL DEFAULT 'open',
          assigned_to BIGINT UNSIGNED NULL,
          reviewed_by BIGINT UNSIGNED NULL,
          reviewed_at TIMESTAMP NULL DEFAULT NULL,
          resolution_note VARCHAR(500) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_message_reports_status (status, created_at),
          KEY idx_message_reports_message (message_id),
          KEY fk_message_reports_reporter (reporter_id),
          CONSTRAINT fk_message_reports_reporter FOREIGN KEY (reporter_id)
            REFERENCES users (id) ON DELETE CASCADE,
          CONSTRAINT fk_message_reports_message FOREIGN KEY (message_id)
            REFERENCES messages (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('Created message_reports table');
    }

    console.log('Message reports migration complete');
  } catch (error) {
    console.error('Message reports migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
