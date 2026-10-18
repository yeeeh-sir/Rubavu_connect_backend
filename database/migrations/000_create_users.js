const { pool } = require('../../config/database');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(50) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(191) NOT NULL,
        password_hash VARCHAR(255) DEFAULT NULL,
        google_id VARCHAR(191) DEFAULT NULL,
        profile_image_url TEXT DEFAULT NULL,
        bio VARCHAR(255) DEFAULT NULL,
        is_verified TINYINT(1) DEFAULT 0,
        is_active TINYINT(1) DEFAULT 1,
        role ENUM('user', 'support', 'moderator', 'admin', 'super_admin') NOT NULL DEFAULT 'user',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        interests VARCHAR(500) DEFAULT NULL,
        who_can_message ENUM('everyone', 'connections') NOT NULL DEFAULT 'everyone',
        who_can_connect ENUM('everyone', 'connections') NOT NULL DEFAULT 'everyone',
        show_online TINYINT(1) NOT NULL DEFAULT 1,
        last_active_at DATETIME DEFAULT NULL,
        phone_number VARCHAR(32) DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_username (username),
        UNIQUE KEY uq_users_email (email),
        UNIQUE KEY uq_users_google_id (google_id),
        UNIQUE KEY uq_users_phone_number (phone_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [columns] = await connection.execute(
      `SELECT c.COLUMN_TYPE, c.COLUMN_KEY, t.ENGINE
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t
         ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
       WHERE c.TABLE_SCHEMA = DATABASE()
         AND c.TABLE_NAME = 'users'
         AND c.COLUMN_NAME = 'id'`
    );
    const idColumn = columns[0];
    const unsignedBigint = /^bigint(?:\(\d+\))? unsigned$/i;
    if (!idColumn || !unsignedBigint.test(idColumn.COLUMN_TYPE) ||
      idColumn.COLUMN_KEY !== 'PRI' || idColumn.ENGINE !== 'InnoDB') {
      throw new Error(
        'The users table must use an InnoDB BIGINT UNSIGNED primary key named id before dependent migrations can run'
      );
    }

    console.log('Users schema migration complete');
  } catch (error) {
    console.error('Users schema migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
