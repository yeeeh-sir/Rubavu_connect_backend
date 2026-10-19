async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function addColumnsIfMissing(connection, table, columns) {
  if (!(await tableExists(connection, table))) {
    console.warn(`Skipping column migration: table '${table}' does not exist`);
    return;
  }

  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));

  const clauses = Object.entries(columns)
    .filter(([name]) => !existing.has(name))
    .map(([name, definition]) => `ADD COLUMN \`${name}\` ${definition}`);

  if (clauses.length === 0) {
    return;
  }

  await connection.query(
    `ALTER TABLE \`${table}\`
        ${clauses.join(',\n        ')}`
  );
}

module.exports = { tableExists, addColumnsIfMissing };
