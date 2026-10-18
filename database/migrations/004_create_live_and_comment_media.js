const { pool } = require('../../config/database');

async function runMigration() {
    const connection = await pool.getConnection();
    try {
        const commentMediaColumns = [
            ['media_url', 'VARCHAR(1000) NULL'],
            ['media_type', "ENUM('image', 'voice') NULL"],
            ['audio_duration', 'DECIMAL(8,2) NULL'],
        ];
        const [existingColumns] = await connection.execute(
            `SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'comments'
               AND COLUMN_NAME IN (?, ?, ?)`,
            commentMediaColumns.map(([column]) => column)
        );
        const existingColumnNames = new Set(existingColumns.map(({ COLUMN_NAME }) => COLUMN_NAME));

        await connection.query(`
      ALTER TABLE comments
        MODIFY COLUMN comment_text TEXT NULL
    `);

        for (const [column, definition] of commentMediaColumns) {
            if (!existingColumnNames.has(column)) {
                await connection.query(
                    `ALTER TABLE comments ADD COLUMN \`${column}\` ${definition}`
                );
            }
        }

        await connection.query(`
      CREATE TABLE IF NOT EXISTS live_sessions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        creator_id BIGINT UNSIGNED NOT NULL,
        title VARCHAR(120) NOT NULL,
        stream_url VARCHAR(1000) NULL,
        status ENUM('live', 'ended') NOT NULL DEFAULT 'live',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP NULL,
        INDEX idx_live_sessions_status_started (status, started_at),
        INDEX idx_live_sessions_creator_status (creator_id, status),
        CONSTRAINT fk_live_sessions_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

        await connection.query(`
      CREATE TABLE IF NOT EXISTS live_viewers (
        live_session_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        left_at TIMESTAMP NULL,
        PRIMARY KEY (live_session_id, user_id),
        INDEX idx_live_viewers_active (live_session_id, left_at),
        CONSTRAINT fk_live_viewers_session FOREIGN KEY (live_session_id) REFERENCES live_sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_live_viewers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

        await connection.query(`
      CREATE TABLE IF NOT EXISTS live_comments (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        live_session_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        comment_text VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_live_comments_session_created (live_session_id, created_at),
        CONSTRAINT fk_live_comments_session FOREIGN KEY (live_session_id) REFERENCES live_sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_live_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

        console.log('Live and comment media migration complete');
    } catch (error) {
        console.error('Live and comment media migration failed:', error.message);
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { runMigration };
