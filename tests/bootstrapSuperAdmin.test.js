const {
  runBootstrap,
  validateEnvironment,
} = require('../scripts/bootstrapSuperAdmin');

const env = {
  NODE_ENV: 'production',
  DB_HOST: 'mysql-production.internal',
  DB_PORT: '3306',
  DB_USER: 'rubavu_api',
  DB_PASSWORD: 'never-print-this',
  DB_NAME: 'rubavu_connect_production',
  ADMIN_EMAIL: 'Admin@example.com',
};

function createDatabase({ account = null, superAdmins = [], usernameConflict = false } = {}) {
  const calls = [];
  const connection = {
    execute: jest.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT DATABASE()')) {
        return [[{ databaseName: env.DB_NAME, serverHost: 'mysql-production-1' }]];
      }
      if (sql.includes("SHOW COLUMNS FROM users")) return [[{ Field: 'role' }]];
      if (sql.includes("SHOW TABLES LIKE 'admin_audit_logs'")) return [[{ name: 'admin_audit_logs' }]];
      if (sql.includes("WHERE email = ?")) return [[account].filter(Boolean)];
      if (sql.includes("WHERE role = 'super_admin'")) return [superAdmins];
      if (sql.includes("WHERE username = ?")) {
        return [usernameConflict ? [{ id: 12 }] : []];
      }
      if (sql.startsWith('INSERT INTO users')) return [{ insertId: 42 }];
      return [{}];
    }),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  return {
    calls,
    connection,
    pool: { getConnection: jest.fn().mockResolvedValue(connection) },
  };
}

function createIo({ answers = [], passwords = [] } = {}) {
  const output = { write: jest.fn() };
  return {
    output,
    ask: jest.fn(async () => answers.shift()),
    askSecret: jest.fn(async () => passwords.shift()),
  };
}

describe('bootstrapSuperAdmin', () => {
  test('requires production configuration and rejects a local database target', () => {
    expect(() => validateEnvironment({ ...env, NODE_ENV: 'development' }))
      .toThrow('NODE_ENV must be production');
    expect(() => validateEnvironment({ ...env, DB_HOST: 'localhost' }))
      .toThrow('Refusing to use a local database host');
    expect(() => validateEnvironment({ ...env, DB_PASSWORD: '' }))
      .toThrow('DB_PASSWORD');
  });

  test('validates configured email and derives a schema-compatible username', () => {
    expect(validateEnvironment(env)).toMatchObject({
      email: 'admin@example.com',
      username: 'admin',
      fullName: 'admin',
    });
    expect(() => validateEnvironment({ ...env, ADMIN_USERNAME: 'bad name' }))
      .toThrow('ADMIN_USERNAME');
  });

  test('check mode reports account state without changing data', async () => {
    const account = { username: 'admin', role: 'admin', is_active: 1 };
    const database = createDatabase({ account });
    const io = createIo();

    const result = await runBootstrap({
      args: ['--check'],
      env,
      database,
      stdout: io.output,
    });

    expect(result).toEqual({ status: 'found', role: 'admin', active: true });
    expect(database.connection.beginTransaction).not.toHaveBeenCalled();
    expect(database.connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    expect(JSON.stringify(io.output.write.mock.calls)).not.toContain(env.DB_PASSWORD);
  });

  test('creates a confirmed initial super admin with a hash, never the plaintext password', async () => {
    const database = createDatabase();
    const io = createIo({
      answers: ['admin@example.com'],
      passwords: ['a-strong-test-password', 'a-strong-test-password'],
    });
    const hashPassword = jest.fn().mockResolvedValue('$2b$12$hashed-password');

    const result = await runBootstrap({
      args: ['--bootstrap'],
      env,
      database,
      stdout: io.output,
      ask: io.ask,
      askSecret: io.askSecret,
      hashPassword,
    });

    expect(result).toEqual({ status: 'created', username: 'admin' });
    expect(hashPassword).toHaveBeenCalledWith('a-strong-test-password');
    expect(database.connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(database.connection.commit).toHaveBeenCalledTimes(1);
    const insert = database.calls.find(({ sql }) => sql.startsWith('INSERT INTO users'));
    expect(insert.params).toEqual([
      'admin',
      'admin',
      'admin@example.com',
      '$2b$12$hashed-password',
      'super_admin',
    ]);
    expect(insert.params).not.toContain('a-strong-test-password');
    expect(database.connection.release).toHaveBeenCalledTimes(1);
  });

  test('requires confirmation before creating an account', async () => {
    const database = createDatabase();
    const io = createIo({ answers: ['wrong@example.com'] });

    await expect(runBootstrap({
      args: ['--bootstrap'],
      env,
      database,
      stdout: io.output,
      ask: io.ask,
      askSecret: io.askSecret,
    })).rejects.toThrow('Confirmation did not match');

    expect(io.askSecret).not.toHaveBeenCalled();
    expect(database.connection.beginTransaction).not.toHaveBeenCalled();
  });

  test('does not change an existing super admin or prompt for confirmation', async () => {
    const account = { id: 42, username: 'admin', role: 'super_admin', is_active: 1 };
    const database = createDatabase({ account });
    const io = createIo();

    const result = await runBootstrap({
      args: ['--bootstrap'],
      env,
      database,
      stdout: io.output,
      ask: io.ask,
    });

    expect(result.status).toBe('already_super_admin');
    expect(io.ask).not.toHaveBeenCalled();
    expect(database.connection.beginTransaction).not.toHaveBeenCalled();
  });

  test('requires confirmation to promote an existing account and preserves its password', async () => {
    const account = { id: 42, username: 'admin', role: 'admin', is_active: 1 };
    const database = createDatabase({ account });
    const io = createIo({ answers: ['admin@example.com'] });

    const result = await runBootstrap({
      args: ['--bootstrap'],
      env,
      database,
      stdout: io.output,
      ask: io.ask,
      askSecret: io.askSecret,
    });

    expect(result).toEqual({ status: 'promoted', username: 'admin' });
    expect(io.askSecret).not.toHaveBeenCalled();
    expect(database.connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE users'))).toBe(true);
    expect(database.connection.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO users'))).toBe(false);
  });

  test('refuses another bootstrap if a super admin already exists', async () => {
    const database = createDatabase({ superAdmins: [{ id: 8 }] });
    const io = createIo();

    await expect(runBootstrap({
      args: ['--bootstrap'],
      env,
      database,
      stdout: io.output,
      ask: io.ask,
      askSecret: io.askSecret,
    })).rejects.toThrow('A super_admin already exists');

    expect(io.ask).not.toHaveBeenCalled();
    expect(database.connection.beginTransaction).not.toHaveBeenCalled();
  });
});
