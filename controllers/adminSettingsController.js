const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../services/auditService');
const { hasPermission } = require('../utils/permissions');
const settingsService = require('../services/settingsService');

async function getSettings(req, res, next) {
  try {
    const map = await settingsService.getSettings();
    const settings = {};
    for (const key of settingsService.EDITABLE_SETTINGS) {
      settings[key] = map[key] ?? '';
    }
    return sendSuccess(res, 'Settings retrieved', { settings });
  } catch (error) {
    next(error);
  }
}

function normalizeValue(key, value, res) {
  if (typeof value === 'boolean') {
    value = value ? 'true' : 'false';
  }
  const str = String(value ?? '').trim();

  switch (key) {
    case 'site_name':
      if (!str || str.length > 100) {
        sendError(res, 'site_name must be 1-100 characters', null, 400);
        return null;
      }
      return str;
    case 'site_tagline':
      if (str.length > 200) {
        sendError(res, 'site_tagline must be at most 200 characters', null, 400);
        return null;
      }
      return str;
    case 'community_guidelines':
      if (str.length > 5000) {
        sendError(res, 'community_guidelines must be at most 5000 characters', null, 400);
        return null;
      }
      return str;
    case 'registration_enabled':
    case 'maintenance_mode':
      if (str !== 'true' && str !== 'false') {
        sendError(res, `${key} must be true or false`, null, 400);
        return null;
      }
      return str;
    default:
      sendError(res, `Unknown setting: ${key}`, null, 400);
      return null;
  }
}

async function updateSettings(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const keys = Object.keys(body);
    if (keys.length === 0) {
      return sendError(res, 'No settings provided', null, 400);
    }

    for (const key of keys) {
      if (!settingsService.EDITABLE_SETTINGS.includes(key)) {
        return sendError(res, `Unknown or protected setting: ${key}`, null, 400);
      }
      if (
        settingsService.SENSITIVE_SETTINGS.includes(key) &&
        !hasPermission(req.user.role, 'settings.sensitive')
      ) {
        await logAudit(req, {
          action: 'auth.denied',
          entityType: 'settings',
          entityId: null,
          details: `role '${req.user.role}' lacks 'settings.sensitive' for key '${key}'`,
        });
        return sendError(res, 'Only a super admin can change this setting', null, 403);
      }
    }

    const current = await settingsService.getSettings();
    const updates = {};
    for (const key of keys) {
      const normalized = normalizeValue(key, body[key], res);
      if (normalized === null) return;
      if (current[key] !== normalized) {
        updates[key] = normalized;
      }
    }

    if (Object.keys(updates).length > 0) {
      await settingsService.setSettings(updates, req.user.id);
      const changes = Object.entries(updates)
        .map(([k, v]) => `${k}: '${current[k] ?? ''}' -> '${v}'`)
        .join('; ');
      await logAudit(req, {
        action: 'settings.update',
        entityType: 'settings',
        entityId: null,
        details: changes,
      });
    }

    const map = await settingsService.getSettings();
    const settings = {};
    for (const key of settingsService.EDITABLE_SETTINGS) {
      settings[key] = map[key] ?? '';
    }
    return sendSuccess(res, 'Settings updated', { settings });
  } catch (error) {
    next(error);
  }
}

async function getPublicSettings(req, res, next) {
  try {
    const map = await settingsService.getSettings();
    const settings = {};
    for (const key of settingsService.PUBLIC_SETTINGS) {
      settings[key] = map[key] ?? '';
    }
    return sendSuccess(res, 'Settings retrieved', { settings });
  } catch (error) {
    next(error);
  }
}

module.exports = { getSettings, updateSettings, getPublicSettings };
