const { pool } = require('../../config/database');

async function inspectPostsSchema(connection) {
  const [rows] = await connection.execute(`
    SELECT DATABASE() AS DATABASE_NAME,
           t.TABLE_NAME, t.ENGINE,
           c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_KEY, c.EXTRA,
           (SELECT COUNT(*)
            FROM information_schema.KEY_COLUMN_USAGE pk
            WHERE pk.TABLE_SCHEMA = DATABASE()
              AND pk.TABLE_NAME = 'posts'
              AND pk.CONSTRAINT_NAME = 'PRIMARY') AS PRIMARY_KEY_COLUMN_COUNT,
           (SELECT GROUP_CONCAT(pk.COLUMN_NAME ORDER BY pk.ORDINAL_POSITION)
            FROM information_schema.KEY_COLUMN_USAGE pk
            WHERE pk.TABLE_SCHEMA = DATABASE()
              AND pk.TABLE_NAME = 'posts'
              AND pk.CONSTRAINT_NAME = 'PRIMARY') AS PRIMARY_KEY_COLUMNS,
           (SELECT COUNT(*)
            FROM information_schema.TABLES other_tables
            WHERE other_tables.TABLE_NAME = 'posts'
              AND other_tables.TABLE_SCHEMA <> COALESCE(DATABASE(), '')) AS POSTS_IN_OTHER_SCHEMAS
    FROM (SELECT 1) AS current_database
    LEFT JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = DATABASE()
      AND t.TABLE_NAME = 'posts'
    LEFT JOIN information_schema.COLUMNS c
      ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
      AND c.TABLE_NAME = t.TABLE_NAME
    ORDER BY c.ORDINAL_POSITION
  `);
  const firstRow = rows[0] || {};

  return {
    database: firstRow.DATABASE_NAME || null,
    postsExists: Boolean(firstRow.TABLE_NAME),
    postsExistsInOtherSchema: Number(firstRow.POSTS_IN_OTHER_SCHEMAS) > 0,
    engine: firstRow.ENGINE || null,
    primaryKeyColumnCount: Number(firstRow.PRIMARY_KEY_COLUMN_COUNT) || 0,
    primaryKeyColumns: firstRow.PRIMARY_KEY_COLUMNS
      ? firstRow.PRIMARY_KEY_COLUMNS.split(',')
      : [],
    columns: rows
      .filter((row) => row.COLUMN_NAME)
      .map(({ COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA }) => ({
        name: COLUMN_NAME,
        type: COLUMN_TYPE,
        nullable: IS_NULLABLE,
        key: COLUMN_KEY,
        extra: EXTRA,
      })),
  };
}

async function runMigration() {
  const connection = await pool.getConnection();
  try {
    const [parents] = await connection.execute(
      `SELECT t.TABLE_NAME, t.ENGINE, c.COLUMN_TYPE,
              (SELECT COUNT(*)
               FROM information_schema.KEY_COLUMN_USAGE pk
               WHERE pk.TABLE_SCHEMA = t.TABLE_SCHEMA
                 AND pk.TABLE_NAME = t.TABLE_NAME
                 AND pk.CONSTRAINT_NAME = 'PRIMARY') AS PRIMARY_KEY_COLUMN_COUNT,
              (SELECT COUNT(*)
               FROM information_schema.KEY_COLUMN_USAGE pk
               WHERE pk.TABLE_SCHEMA = t.TABLE_SCHEMA
                 AND pk.TABLE_NAME = t.TABLE_NAME
                 AND pk.CONSTRAINT_NAME = 'PRIMARY'
                 AND pk.COLUMN_NAME = 'id') AS ID_IS_PRIMARY_KEY
       FROM information_schema.TABLES t
       JOIN information_schema.COLUMNS c
         ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
         AND c.TABLE_NAME = t.TABLE_NAME
         AND c.COLUMN_NAME = 'id'
       WHERE t.TABLE_SCHEMA = DATABASE()
         AND t.TABLE_NAME IN (?, ?)`,
      ['posts', 'users']
    );
    const parentColumnTypes = {};
    for (const tableName of ['posts', 'users']) {
      const parent = parents.find((table) => table.TABLE_NAME === tableName);
      const columnType = parent?.COLUMN_TYPE?.toUpperCase();
      if (
        !parent ||
        parent.ENGINE !== 'InnoDB' ||
        !/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\(\d+\))?(?: UNSIGNED)?$/.test(columnType) ||
        Number(parent.PRIMARY_KEY_COLUMN_COUNT) !== 1 ||
        Number(parent.ID_IS_PRIMARY_KEY) !== 1
      ) {
        if (tableName === 'posts') {
          const diagnostics = await inspectPostsSchema(connection);
          console.error('Read-only posts schema diagnostics:', JSON.stringify(diagnostics));
        }
        throw new Error(
          `Cannot create comments table: ${tableName}.id must be a single-column InnoDB integer primary key; ` +
          `found ${parent ? `${parent.ENGINE} ${parent.COLUMN_TYPE}` : 'no table or id column'}`
        );
      }
      parentColumnTypes[tableName] = columnType;
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        post_id ${parentColumnTypes.posts} NOT NULL,
        user_id ${parentColumnTypes.users} NOT NULL,
        comment_text TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_comments_post (post_id),
        KEY idx_comments_user (user_id),
        CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('Comments schema migration complete');
  } catch (error) {
    console.error('Comments table migration failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runMigration };
