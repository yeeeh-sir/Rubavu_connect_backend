const ROLE_RANK = {
  user: 0,
  support: 1,
  moderator: 2,
  admin: 3,
  super_admin: 4,
};

const ROLES = Object.keys(ROLE_RANK);

const STAFF_ROLES = ['support', 'moderator', 'admin', 'super_admin'];

const ROLE_PERMISSIONS = {
  support: [
    'dashboard.read',
    'users.read',
    'reports.read',
  ],
  moderator: [
    'dashboard.read',
    'users.read',
    'reports.read',
    'reports.write',
    'content.read',
    'content.write',
    'live.read',
    'live.write',
    'safety.read',
    'safety.write',
    'connections.read',
    'notifications.read',
  ],
  admin: [
    'dashboard.read',
    'users.read',
    'users.write',
    'reports.read',
    'reports.write',
    'content.read',
    'content.write',
    'live.read',
    'live.write',
    'safety.read',
    'safety.write',
    'connections.read',
    'connections.write',
    'notifications.read',
    'roles.write',
    'analytics.read',
    'settings.read',
    'settings.write',
    'audit.read',
    'messages.read',
  ],
  super_admin: [
    'dashboard.read',
    'users.read',
    'users.write',
    'reports.read',
    'reports.write',
    'content.read',
    'content.write',
    'live.read',
    'live.write',
    'safety.read',
    'safety.write',
    'connections.read',
    'connections.write',
    'notifications.read',
    'roles.write',
    'analytics.read',
    'settings.read',
    'settings.write',
    'settings.sensitive',
    'audit.read',
    'messages.read',
  ],
};

const ALL_PERMISSIONS = [
  'dashboard.read',
  'users.read',
  'users.write',
  'reports.read',
  'reports.write',
  'content.read',
  'content.write',
  'live.read',
  'live.write',
  'safety.read',
  'safety.write',
  'connections.read',
  'connections.write',
  'notifications.read',
  'roles.write',
  'analytics.read',
  'settings.read',
  'settings.write',
  'settings.sensitive',
  'audit.read',
  'messages.read',
];

function getRoleRank(role) {
  return ROLE_RANK[role] ?? 0;
}

function hasPermission(role, permission) {
  const granted = ROLE_PERMISSIONS[role] || [];
  return granted.includes(permission);
}

function canActOnUser(actorRole, targetRole) {
  return getRoleRank(actorRole) > getRoleRank(targetRole);
}

function canAssignRole(actorRole, targetCurrentRole, newRole) {
  if (!ROLES.includes(newRole)) return false;
  if (getRoleRank(actorRole) <= getRoleRank(targetCurrentRole)) return false;
  if (actorRole === 'super_admin') return true;
  return getRoleRank(newRole) < getRoleRank(actorRole);
}

module.exports = {
  ROLE_RANK,
  ROLES,
  STAFF_ROLES,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  getRoleRank,
  hasPermission,
  canActOnUser,
  canAssignRole,
};
