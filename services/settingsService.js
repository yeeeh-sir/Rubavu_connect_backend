const { query, execute } = require('../config/database');

const CACHE_TTL_MS = 30 * 1000;

let cache = null;
let cacheAt = 0;

const PUBLIC_SETTINGS = [
  'site_name',
  'site_tagline',
  'community_guidelines',
  'registration_enabled',
];

const EDITABLE_SETTINGS = [
  'site_name',
  'site_tagline',
  'community_guidelines',
  'registration_enabled',
  'maintenance_mode',
];

const SENSITIVE_SETTINGS = ['maintenance_mode', 'registration_enabled'];

async function getSettings() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) {
    return cache;
  }
  const rows = await query('SELECT setting_key, setting_value FROM platform_settings');
  const map = {};
  for (const row of rows) {
    map[row.setting_key] = row.setting_value;
  }
  cache = map;
  cacheAt = now;
  return map;
}

async function getSetting(key, fallback = null) {
  const map = await getSettings();
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

function invalidateSettingsCache() {
  cache = null;
  cacheAt = 0;
}

async function setSettings(updates, actorId) {
  for (const [key, value] of Object.entries(updates)) {
    await execute(
      `INSERT INTO platform_settings (setting_key, setting_value, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [key, String(value), actorId || null]
    );
  }
  invalidateSettingsCache();
}

async function isRegistrationEnabled() {
  return (await getSetting('registration_enabled', 'true')) !== 'false';
}

async function assertRegistrationOpen() {
  if (!(await isRegistrationEnabled())) {
    const error = new Error('Registration is currently disabled');
    error.statusCode = 403;
    throw error;
  }
}

async function isMaintenanceMode() {
  return (await getSetting('maintenance_mode', 'false')) === 'true';
}

module.exports = {
  PUBLIC_SETTINGS,
  EDITABLE_SETTINGS,
  SENSITIVE_SETTINGS,
  getSettings,
  getSetting,
  invalidateSettingsCache,
  setSettings,
  isRegistrationEnabled,
  assertRegistrationOpen,
  isMaintenanceMode,
};
