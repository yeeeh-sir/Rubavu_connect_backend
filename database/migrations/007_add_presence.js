const { pool } = require('../../config/database');
const { addColumnsIfMissing } = require('./helpers');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    await addColumnsIfMissing(connection, 'users', {
      last_active_at: 'DATETIME NULL AFTER show_online',
    });

    console.log('Presence migration complete');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };