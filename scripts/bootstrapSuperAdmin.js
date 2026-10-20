const readline = require('readline');
const bcrypt = require('bcryptjs');

const PASSWORD_ROUNDS = 12;
const REQUIRED_DATABASE_VARS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

function validateEnvironment(env) {
  if (env.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV must be production to run this command.');
  }
  const missing = REQUIRED_DATABASE_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
  if (/^(localhost|127(?:\.\d{1,3}){3}|::1)$/i.test(env.DB_HOST)) {
    throw new Error('Refusing to use a local database host for the production bootstrap.');
  }

  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email || email.length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set ADMIN_EMAIL to the administrator email address.');
  }

  const suggestedUsername = email.split('@')[0]
    .replace(/[^a-zA-Z0-9_.]/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 50);
  const username = env.ADMIN_USERNAME
    ? String(env.ADMIN_USERNAME).trim()
    : (suggestedUsername.length >= 3 ? suggestedUsername : `${suggestedUsername || 'user'}.admin`);
  if (username.length < 3 || username.length > 50 || !/^[a-zA-Z0-9_.]+$/.test(username)) {
    throw new Error('Set ADMIN_USERNAME to a unique 3-50 character username.');
  }

  const fullName = String(env.ADMIN_FULL_NAME || email.split('@')[0]).trim();
  if (!fullName || fullName.length > 100) {
    throw new Error('ADMIN_FULL_NAME must be between 1 and 100 characters.');
  }

  return { email, username, fullName };
}

function promptLine(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('An interactive terminal is required for explicit confirmation.');
  }
  const terminal = readline.createInterface({ input, output });
  return new Promise((resolve, reject) => {
    terminal.once('SIGINT', () => {
      terminal.close();
      reject(new Error('Confirmation cancelled.'));
    });
    terminal.question(question, (answer) => {
      terminal.close();
      resolve(answer);
    });
  });
}

function promptSecret(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('A secure interactive terminal is required to enter the password.');
  }

  return new Promise((resolve, reject) => {
    const previousRawMode = Boolean(input.isRaw);
    let secret = '';
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      input.removeListener('data', onData);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(secret);
    };

    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003' || character === '\u0004') {
          finish(new Error('Password entry cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          secret = secret.slice(0, -1);
        } else if (character >= ' ') {
          secret += character;
        }
      }
    };

    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function verifySchema(connection) {
  const [roleColumns] = await connection.execute("SHOW COLUMNS FROM users LIKE 'role'");
  const [auditTables] = await connection.execute("SHOW TABLES LIKE 'admin_audit_logs'");
  if (roleColumns.length === 0 || auditTables.length === 0) {
    throw new Error('Required admin schema is missing. Deploy the backend migrations, then retry.');
  }
}

async function getTarget(connection, configuredDatabase, output) {
  const [rows] = await connection.execute(
    'SELECT DATABASE() AS databaseName, @@hostname AS serverHost'
  );
  const target = rows[0];
  if (!target?.databaseName || target.databaseName !== configuredDatabase) {
    throw new Error('The connected database does not match DB_NAME; refusing to continue.');
  }
  output.write(`Connected production database: ${target.databaseName} on ${target.serverHost}\n`);
  return target;
}

async function runBootstrap({
  args = [],
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  database = require('../config/database'),
  hashPassword = (password) => bcrypt.hash(password, PASSWORD_ROUNDS),
  ask = (question) => promptLine(question, { input: stdin, output: stdout }),
  askSecret = (question) => promptSecret(question, { input: stdin, output: stdout }),
} = {}) {
  if (args.length !== 1 || !['--check', '--bootstrap'].includes(args[0])) {
    throw new Error('Usage: node scripts/bootstrapSuperAdmin.js --check|--bootstrap');
  }

  const { email, username, fullName } = validateEnvironment(env);
  const connection = await database.pool.getConnection();

  try {
    await getTarget(connection, env.DB_NAME, stdout);

    if (args[0] === '--check') {
      const [rows] = await connection.execute(
        'SELECT username, role, is_active FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      if (rows.length === 0) {
        stdout.write(`No account found for ${email} in the connected production database.\n`);
        return { status: 'missing' };
      }
      const account = rows[0];
      stdout.write(
        `Account found: ${email}; username=${account.username}; role=${account.role}; active=${Boolean(account.is_active)}\n`
      );
      return { status: 'found', role: account.role, active: Boolean(account.is_active) };
    }

    await verifySchema(connection);
    const [initialRows] = await connection.execute(
      'SELECT id, username, role, is_active FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    const initialAccount = initialRows[0] || null;
    if (initialAccount?.role === 'super_admin') {
      stdout.write(`Account ${email} is already a super_admin; no changes made.\n`);
      return { status: 'already_super_admin' };
    }
    if (initialAccount && !initialAccount.is_active) {
      throw new Error('The existing account is inactive; no role or account status was changed.');
    }

    const [superAdminRows] = await connection.execute(
      "SELECT id FROM users WHERE role = 'super_admin' LIMIT 1"
    );
    if (superAdminRows.length > 0) {
      throw new Error(
        'A super_admin already exists. Use the audited admin role-management flow instead.'
      );
    }

    const [usernameRows] = await connection.execute(
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    if (!initialAccount && usernameRows.length > 0) {
      throw new Error('ADMIN_USERNAME is already in use; choose a different username and retry.');
    }

    const action = initialAccount ? 'promote the existing account' : 'create the account';
    stdout.write(`About to ${action} as super_admin in the connected production database.\n`);
    const confirmation = await ask(`Type ${email} to confirm: `);
    if (confirmation.trim().toLowerCase() !== email) {
      throw new Error('Confirmation did not match; no changes made.');
    }

    let passwordHash;
    if (!initialAccount) {
      const password = await askSecret('New administrator password (input hidden): ');
      const confirmationPassword = await askSecret('Re-enter administrator password: ');
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }
      if (password !== confirmationPassword) {
        throw new Error('Passwords did not match; no changes made.');
      }
      passwordHash = await hashPassword(password);
    }

    await connection.beginTransaction();
    try {
      const [currentRows] = await connection.execute(
        'SELECT id, username, role, is_active FROM users WHERE email = ? LIMIT 1 FOR UPDATE',
        [email]
      );
      const currentAccount = currentRows[0] || null;

      if (Boolean(currentAccount) !== Boolean(initialAccount) ||
        (currentAccount && (
          currentAccount.id !== initialAccount.id ||
          currentAccount.role !== initialAccount.role ||
          currentAccount.is_active !== initialAccount.is_active
        ))) {
        throw new Error('The account changed during confirmation; no changes made. Run the command again.');
      }
      if (currentAccount?.role === 'super_admin') {
        throw new Error('The account is already a super_admin; no changes made.');
      }
      const [existingSuperAdmins] = await connection.execute(
        "SELECT id FROM users WHERE role = 'super_admin' LIMIT 1 FOR UPDATE"
      );
      if (existingSuperAdmins.length > 0) {
        throw new Error(
          'A super_admin already exists. Use the audited admin role-management flow instead.'
        );
      }

      let userId;
      let actorUsername;
      let actionName;
      let details;

      if (currentAccount) {
        userId = currentAccount.id;
        actorUsername = currentAccount.username;
        actionName = 'user.role.change';
        details = `${currentAccount.username}: ${currentAccount.role} -> super_admin (bootstrap CLI)`;
        await connection.execute(
          'UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?',
          ['super_admin', userId]
        );
      } else {
        const [conflicts] = await connection.execute(
          'SELECT id FROM users WHERE username = ? LIMIT 1 FOR UPDATE',
          [username]
        );
        if (conflicts.length > 0) {
          throw new Error('ADMIN_USERNAME became unavailable; no changes made. Run the command again.');
        }
        const [result] = await connection.execute(
          'INSERT INTO users (full_name, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
          [fullName, username, email, passwordHash, 'super_admin']
        );
        userId = result.insertId;
        actorUsername = username;
        actionName = 'user.create';
        details = `${username}: initial super_admin created via bootstrap CLI`;
      }

      await connection.execute(
        `INSERT INTO admin_audit_logs
          (actor_id, actor_username, action, entity_type, entity_id, details, ip_address)
         VALUES (?, ?, ?, 'user', ?, ?, NULL)`,
        [userId, actorUsername, actionName, userId, details]
      );
      await connection.commit();

      const status = currentAccount ? 'promoted' : 'created';
      stdout.write(`Administrator account ${email} ${status} as super_admin.\n`);
      return { status, username: actorUsername };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { pool } = require('../config/database');
  runBootstrap({ args: process.argv.slice(2), database: { pool } })
    .catch((error) => {
      if (error.code) {
        console.error(`Bootstrap failed due to a database/runtime error (code: ${error.code}).`);
      } else {
        console.error(`Bootstrap failed: ${error.message}`);
      }
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = {
  runBootstrap,
  validateEnvironment,
  verifySchema,
};
