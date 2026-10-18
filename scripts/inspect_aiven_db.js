const { pool, query } = require('../config/database');

async function inspect() {
  try {
    const db = await query('SELECT DATABASE() AS db');
    console.log('SELECT DATABASE():', JSON.stringify(db, null, 2));
    
    const tables = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, ENGINE, TABLE_ROWS
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);
    console.log('Tables in current DB:', JSON.stringify(tables, null, 2));
    
    const postsAnywhere = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, ENGINE, TABLE_TYPE
      FROM information_schema.TABLES
      WHERE TABLE_NAME = 'posts'
      ORDER BY TABLE_SCHEMA
    `);
    console.log('Posts anywhere:', JSON.stringify(postsAnywhere, null, 2));
    
    const postCols = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM information_schema.COLUMNS
      WHERE TABLE_NAME LIKE '%post%'
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
    `);
    console.log('Post-related columns:', JSON.stringify(postCols, null, 2));
    
    await pool.end();
  } catch (e) {
    console.error('ERR', e);
    process.exit(1);
  }
}

inspect();
