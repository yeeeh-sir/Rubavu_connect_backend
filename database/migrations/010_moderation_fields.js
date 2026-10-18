const { pool } = require('../../config/database');

const REPORT_TABLES = ['post_reports', 'comment_reports', 'user_reports', 'live_reports'];

async function ensureReportColumns(connection, table) {
  await connection.query(`
    ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS assigned_to BIGINT UNSIGNED NULL,
      ADD COLUMN IF NOT EXISTS reviewed_by BIGINT UNSIGNED NULL,
      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS resolution_note VARCHAR(500) NULL
  `);

  const [statusRows] = await connection.query(
    `SELECT COLUMN_TYPE AS ct FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'status'`,
    [table]
  );
  if (statusRows.length > 0 && !String(statusRows[0].ct).includes('dismissed')) {
    await connection.query(
      `ALTER TABLE ${table} MODIFY COLUMN status ENUM('open','reviewed','resolved','dismissed') NOT NULL DEFAULT 'open'`
    );
  }
}

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    for (const table of REPORT_TABLES) {
      await ensureReportColumns(connection, table);
    }

    await connection.query(`
      ALTER TABLE posts
        ADD COLUMN IF NOT EXISTS is_hidden TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS hidden_reason VARCHAR(500) NULL,
        ADD COLUMN IF NOT EXISTS hidden_by BIGINT UNSIGNED NULL,
        ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP NULL DEFAULT NULL
    `);

    const [noteTables] = await connection.query(
      "SHOW TABLES LIKE 'report_notes'"
    );
    if (noteTables.length === 0) {
      await connection.query(`
        CREATE TABLE report_notes (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          report_type ENUM('post','comment','user','live','message') NOT NULL,
          report_id BIGINT UNSIGNED NOT NULL,
          author_id BIGINT UNSIGNED NULL,
          author_username VARCHAR(50) NULL,
          note VARCHAR(1000) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_report_notes_target (report_type, report_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('Created report_notes table');
    }

    console.log('Moderation fields migration complete');
  } catch (error) {
    console.error('Moderation fields migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
