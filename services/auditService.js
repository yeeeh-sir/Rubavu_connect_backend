const { execute } = require('../config/database');

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 45);
  }
  const remote = req.socket && req.socket.remoteAddress;
  return remote ? String(remote).slice(0, 45) : null;
}

async function logAudit(req, { action, entityType = null, entityId = null, details = null }) {
  try {
    const actor = req.user || {};
    await execute(
      `INSERT INTO admin_audit_logs
         (actor_id, actor_username, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.id || null,
        actor.username || null,
        action,
        entityType,
        entityId != null ? entityId : null,
        details != null ? String(details).slice(0, 2000) : null,
        getRequestIp(req),
      ]
    );
  } catch (error) {
    console.error('Audit logging failed:', error.message);
  }
}

module.exports = { logAudit, getRequestIp };
