const { isMaintenanceMode } = require('../services/settingsService');

const EXEMPT_PATHS = [
  /^\/api\/health(\/|$)/,
  /^\/api\/auth\/login\/?$/,
  /^\/api\/auth\/logout\/?$/,
  /^\/api\/auth\/me\/?$/,
  /^\/api\/admin(\/|$)/,
  /^\/api\/settings(\/|$)/,
];

async function maintenanceGuard(req, res, next) {
  try {
    if (!req.path.startsWith('/api/')) {
      return next();
    }
    if (EXEMPT_PATHS.some((pattern) => pattern.test(req.path))) {
      return next();
    }
    const maintenance = await isMaintenanceMode();
    if (!maintenance) {
      return next();
    }
    return res.status(503).json({
      success: false,
      message: 'Rubavu Connect is in maintenance mode. Please try again later.',
    });
  } catch (error) {
    return next();
  }
}

module.exports = { maintenanceGuard };
