const { pool } = require('../../config/database');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS last_active_at DATETIME NULL AFTER show_online
    `);

    console.log('Presence migration complete');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };