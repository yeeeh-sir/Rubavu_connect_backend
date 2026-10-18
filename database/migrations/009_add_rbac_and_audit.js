const { pool } = require('../../config/database');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    const [roleColumns] = await connection.query(
      "SHOW COLUMNS FROM users LIKE 'role'"
    );
    if (roleColumns.length === 0) {
      await connection.query(
        "ALTER TABLE users ADD COLUMN role ENUM('user','support','moderator','admin','super_admin') NOT NULL DEFAULT 'user' AFTER is_active"
      );
      console.log('Added users.role column');
    }

    const [auditTables] = await connection.query(
      "SHOW TABLES LIKE 'admin_audit_logs'"
    );
    if (auditTables.length === 0) {
      await connection.query(`
        CREATE TABLE admin_audit_logs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          actor_id BIGINT UNSIGNED NULL,
          actor_username VARCHAR(50) NULL,
          action VARCHAR(100) NOT NULL,
          entity_type VARCHAR(50) NULL,
          entity_id BIGINT UNSIGNED NULL,
          details TEXT NULL,
          ip_address VARCHAR(45) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_audit_action (action, created_at),
          KEY idx_audit_actor (actor_id),
          KEY idx_audit_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('Created admin_audit_logs table');
    }

    const [settingsTables] = await connection.query(
      "SHOW TABLES LIKE 'platform_settings'"
    );
    if (settingsTables.length === 0) {
      await connection.query(`
        CREATE TABLE platform_settings (
          setting_key VARCHAR(100) NOT NULL,
          setting_value TEXT NOT NULL,
          updated_by BIGINT UNSIGNED NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('Created platform_settings table');
    }

    await connection.query(`
      INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES
        ('site_name', 'Rubavu Connect'),
        ('site_tagline', 'Connect with your community'),
        ('community_guidelines', ''),
        ('registration_enabled', 'true'),
        ('maintenance_mode', 'false')
    `);

    console.log('RBAC and audit migration complete');
  } catch (error) {
    console.error('RBAC and audit migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
