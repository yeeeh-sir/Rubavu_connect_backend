const { pool } = require('../../config/database');
const { addColumnsIfMissing } = require('./helpers');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS post_media (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        post_id BIGINT UNSIGNED NOT NULL,
        media_type ENUM('image', 'video') NOT NULL,
        media_url VARCHAR(1000) NOT NULL,
        thumbnail_url VARCHAR(1000) NULL,
        video_duration DECIMAL(6,2) NULL,
        position INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_post_media_post (post_id),
        CONSTRAINT fk_post_media_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS post_reports (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        reporter_id BIGINT UNSIGNED NOT NULL,
        post_id BIGINT UNSIGNED NOT NULL,
        reason VARCHAR(500) NOT NULL,
        status ENUM('open', 'reviewed', 'resolved') NOT NULL DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_post_reports_status (status, created_at),
        INDEX idx_post_reports_post (post_id),
        CONSTRAINT fk_post_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_post_reports_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS comment_reports (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        reporter_id BIGINT UNSIGNED NOT NULL,
        comment_id BIGINT UNSIGNED NOT NULL,
        reason VARCHAR(500) NOT NULL,
        status ENUM('open', 'reviewed', 'resolved') NOT NULL DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_comment_reports_status (status, created_at),
        INDEX idx_comment_reports_comment (comment_id),
        CONSTRAINT fk_comment_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_comment_reports_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS live_reports (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        reporter_id BIGINT UNSIGNED NOT NULL,
        live_session_id BIGINT UNSIGNED NOT NULL,
        reason VARCHAR(500) NOT NULL,
        status ENUM('open', 'reviewed', 'resolved') NOT NULL DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_live_reports_status (status, created_at),
        CONSTRAINT fk_live_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_live_reports_session FOREIGN KEY (live_session_id) REFERENCES live_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await addColumnsIfMissing(connection, 'users', {
      interests: 'VARCHAR(500) NULL',
      who_can_message: "ENUM('everyone', 'connections') NOT NULL DEFAULT 'everyone'",
      who_can_connect: "ENUM('everyone', 'connections') NOT NULL DEFAULT 'everyone'",
      show_online: 'TINYINT(1) NOT NULL DEFAULT 1',
    });

    await addColumnsIfMissing(connection, 'post_collaborators', {
      status: "ENUM('pending', 'accepted') NOT NULL DEFAULT 'accepted'",
    });

    await connection.query(`
      ALTER TABLE notifications
        MODIFY COLUMN type ENUM('follow', 'like', 'comment', 'message', 'connection_request', 'connection_accepted', 'collaboration_invite', 'collaboration_accepted', 'live', 'report') NOT NULL
    `);

    await addColumnsIfMissing(connection, 'live_sessions', {
      created_by: 'BIGINT UNSIGNED NOT NULL DEFAULT 0',
      viewer_visibility: "ENUM('public', 'connections') NOT NULL DEFAULT 'public'",
    });

    await addColumnsIfMissing(connection, 'statuses', {
      upload_id: 'VARCHAR(100) NULL',
    });

    console.log('Platform features migration complete');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };