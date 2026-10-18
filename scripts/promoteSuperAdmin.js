/**
 * One-time Super Admin bootstrap.
 *
 * Run from the Backend directory on a trusted server only:
 *   node scripts/promoteSuperAdmin.js <email|username>
 *
 * The script applies the RBAC migration (idempotent) and promotes the
 * given existing account to super_admin. Roles are never granted through
 * first-user registration or client-side requests.
 */
require('dotenv').config();

const { query, execute, pool } = require('../config/database');
const { runMigration: runRbacMigration } = require('../database/migrations/009_add_rbac_and_audit');

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error('Usage: node scripts/promoteSuperAdmin.js <email|username>');
    process.exit(1);
  }

  await runRbacMigration();

  const users = await query(
    'SELECT id, username, email, role FROM users WHERE email = ? OR username = ? LIMIT 1',
    [identifier, identifier]
  );

  if (users.length === 0) {
    console.error(`No account found for "${identifier}". Register the account first, then re-run.`);
    process.exit(1);
  }

  const user = users[0];
  if (user.role === 'super_admin') {
    console.log(`Account ${user.username} (#${user.id}) is already a super_admin.`);
    return;
  }

  await execute('UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?', [
    'super_admin',
    user.id,
  ]);
  await execute(
    `INSERT INTO admin_audit_logs (actor_id, actor_username, action, entity_type, entity_id, details, ip_address)
     VALUES (?, ?, 'user.role.change', 'user', ?, ?, NULL)`,
    [user.id, user.username, user.id, `${user.username}: ${user.role} -> super_admin (bootstrap script)`]
  );

  console.log(`Account ${user.username} (#${user.id}) promoted to super_admin (was ${user.role}).`);
  console.log('This change is recorded in admin_audit_logs.');
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error('Bootstrap failed:', error.message);
    try {
      await pool.end();
    } catch (_) {
      // ignore
    }
    process.exit(1);
  });
