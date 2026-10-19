const migrations = [
  ['users', require('./migrations/000_create_users').runMigration],
  ['posts', require('./migrations/003_create_posts_table').runMigration],
  ['notifications', require('./migrations/001_create_notifications').runMigration],
  ['connections', require('./migrations/002_create_connections').runMigration],
  ['follows', require('./migrations/002a_create_follows_table').runMigration],
  ['statuses', require('./migrations/002b_create_statuses_table').runMigration],
  ['messages', require('./migrations/002c_create_messages_table').runMigration],
  ['post likes', require('./migrations/003b_create_post_likes_table').runMigration],
  ['safety', require('./migrations/003_create_safety').runMigration],
  ['comments', require('./migrations/003a_create_comments_table').runMigration],
  ['live and comment media', require('./migrations/004_create_live_and_comment_media').runMigration],
  ['post audience', require('./migrations/005_add_post_audience_collaborators').runMigration],
  ['platform features', require('./migrations/006_create_platform_features').runMigration],
  ['presence', require('./migrations/007_add_presence').runMigration],
  ['phone number', require('./migrations/008_add_phone_number').runMigration],
  ['RBAC', require('./migrations/009_add_rbac_and_audit').runMigration],
  ['moderation', require('./migrations/010_moderation_fields').runMigration],
  ['message reports', require('./migrations/011_message_reports').runMigration],
];

async function runMigrations() {
  for (const [name, runMigration] of migrations) {
    console.log(`Running ${name} migration`);
    await runMigration();
  }
}

module.exports = {
  runMigrations,
  migrationNames: migrations.map(([name]) => name),
};
