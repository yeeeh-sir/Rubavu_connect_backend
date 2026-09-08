const { pool } = require('../../config/database');

async function runMigration() {
    const connection = await pool.getConnection();
    try {
        await connection.query(`
      ALTER TABLE notifications
      MODIFY COLUMN type ENUM('follow', 'like', 'comment', 'message', 'connection_request', 'connection_accepted') NOT NULL
    `);

        await connection.query(`
      CREATE TABLE IF NOT EXISTS connections (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        requester_id BIGINT UNSIGNED NOT NULL,
        addressee_id BIGINT UNSIGNED NOT NULL,
        status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_connections_pair (requester_id, addressee_id),
        INDEX idx_connections_addressee_status (addressee_id, status),
        INDEX idx_connections_requester_status (requester_id, status),
        CONSTRAINT fk_connections_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_connections_addressee FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

        console.log('Connections migration complete');
    } finally {
        connection.release();
    }
}

module.exports = { runMigration };
