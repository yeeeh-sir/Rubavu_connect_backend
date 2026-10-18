const { pool } = require('../../config/database');

async function runMigration() {
    const connection = await pool.getConnection();
    try {
        const [columns] = await connection.query(
            `SELECT 1 FROM information_schema.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() 
               AND TABLE_NAME = 'posts' 
               AND COLUMN_NAME = 'audience' 
             LIMIT 1`
        );
        if (columns.length === 0) {
            await connection.query(`
              ALTER TABLE posts
                ADD COLUMN audience ENUM('public', 'friends', 'private') NOT NULL DEFAULT 'public'
            `);
        }

        await connection.query(`
          CREATE TABLE IF NOT EXISTS post_collaborators (
            post_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (post_id, user_id),
            INDEX idx_post_collaborators_user (user_id, created_at),
            CONSTRAINT fk_post_collaborators_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            CONSTRAINT fk_post_collaborators_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('Post audience migration complete');
    } finally {
        connection.release();
    }
}

module.exports = { runMigration };
