// First-party origins that are always allowed to make credentialed requests.
// The production frontend is listed here so the API works even when CLIENT_URL
// is not configured on the host; localhost origins keep local development working.
const DEFAULT_PRODUCTION_ORIGINS = ['https://rubavuconnect.vercel.app'];
const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const DEFAULT_ORIGINS = [...DEFAULT_PRODUCTION_ORIGINS, ...DEFAULT_DEV_ORIGINS];

const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization'];

function parseOriginList(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getAllowedOrigins(env = process.env) {
  const configured = [
    ...parseOriginList(env.CLIENT_URLS),
    ...parseOriginList(env.CLIENT_URL),
  ];
  return Array.from(new Set([...configured, ...DEFAULT_ORIGINS]));
}

function buildCorsOptions(env = process.env) {
  const allowedOrigins = getAllowedOrigins(env);

  return {
    origin(origin, callback) {
      // Requests without an Origin header (same-origin, server-to-server, curl)
      // are allowed; browser cross-origin requests must match the allowlist.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
  };
}

function buildSocketCorsOptions(env = process.env) {
  return {
    origin: getAllowedOrigins(env),
    credentials: true,
    methods: ['GET', 'POST'],
  };
}

module.exports = {
  parseOriginList,
  getAllowedOrigins,
  buildCorsOptions,
  buildSocketCorsOptions,
  DEFAULT_ORIGINS,
  DEFAULT_PRODUCTION_ORIGINS,
  DEFAULT_DEV_ORIGINS,
};
