const { pool } = require('../../config/database');
const { addColumnsIfMissing } = require('./helpers');

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    await addColumnsIfMissing(connection, 'users', {
      phone_number: 'VARCHAR(32) NULL',
    });

    const [indexes] = await connection.query(
      'SHOW INDEX FROM users WHERE Key_name = ?',
      ['uq_users_phone_number']
    );
    if (indexes.length === 0) {
      await connection.query(
        'CREATE UNIQUE INDEX uq_users_phone_number ON users (phone_number)'
      );
    }

    console.log('Phone number migration complete');
  } catch (error) {
    console.error('Phone number migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
