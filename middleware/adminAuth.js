const { hasPermission } = require('../utils/permissions');
const { logAudit } = require('../services/auditService');

async function deny(res, req, reason) {
  await logAudit(req, {
    action: 'auth.denied',
    entityType: 'route',
    entityId: null,
    details: `${req.method} ${req.originalUrl} - ${reason}`,
  });
  return res.status(403).json({
    success: false,
    message: 'You do not have permission to perform this action.',
  });
}

function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Access denied. No token provided.',
        });
      }
      const role = req.user.role || 'user';
      if (!roles.includes(role)) {
        return await deny(res, req, `role '${role}' requires one of [${roles.join(', ')}]`);
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Access denied. No token provided.',
        });
      }
      const role = req.user.role || 'user';
      if (!hasPermission(role, permission)) {
        return await deny(res, req, `role '${role}' lacks permission '${permission}'`);
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { requireRole, requirePermission };
