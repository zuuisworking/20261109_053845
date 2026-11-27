require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseBoundedInteger(value, fallback, { min, max, name }) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return parsed;
}

function normalizeOrigin(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must contain at least one valid HTTP(S) origin.`);
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch (_error) {
    throw new Error(`${name} contains an invalid URL.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === 'null') {
    throw new Error(`${name} may contain only HTTP(S) origins.`);
  }

  if (isProduction && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS in production.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain embedded credentials.`);
  }

  return parsed.origin;
}

function parseAdditionalOrigins(value) {
  if (!value || !String(value).trim()) {
    return [];
  }

  const rawValue = String(value).trim();
  let entries;

  if (rawValue.startsWith('[')) {
    try {
      entries = JSON.parse(rawValue);
    } catch (_error) {
      throw new Error('CLIENT_URLS must be a comma-separated list or a JSON array of origins.');
    }

    if (!Array.isArray(entries)) {
      throw new Error('CLIENT_URLS must be a comma-separated list or a JSON array of origins.');
    }
  } else {
    entries = rawValue.split(',');
  }

  return entries
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => normalizeOrigin(entry, 'CLIENT_URLS'));
}

function sanitizeMongoUri(uri) {
  try {
    const parsed = new URL(uri);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_error) {
    return '[configured MongoDB URI]';
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

function readSecretValue(name) {
  const filePath = String(process.env[`${name}_FILE`] || '').trim();
  const environmentValue = process.env[name];
  if (filePath && environmentValue !== undefined && String(environmentValue).trim()) {
    throw new Error(`${name} and ${name}_FILE cannot both be configured.`);
  }
  if (filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch (error) {
      throw new Error(`${name}_FILE could not be read: ${error.code || 'READ_ERROR'}.`);
    }
  }
  return typeof environmentValue === 'string' ? environmentValue.trim() : '';
}

function resolveSecret(name) {
  const value = readSecretValue(name);

  if (isProduction) {
    if (!value || value.length < 32) {
      throw new Error(`${name} must be explicitly configured with at least 32 characters in production.`);
    }

    if (/replace-with|fallback|change[-_]?me|example|super_secret/i.test(value)) {
      throw new Error(`${name} contains a known placeholder value and cannot be used in production.`);
    }
  }

  return value || crypto.randomBytes(48).toString('base64url');
}

function resolveConfiguredValue(name, fallback = '') {
  const value = readSecretValue(name);
  return value || fallback;
}

const sessionSecret = resolveSecret('SESSION_SECRET');

if (isProduction && !process.env.CLIENT_URL) {
  throw new Error('CLIENT_URL must be explicitly configured in production.');
}

const configuredMongoUri = resolveConfiguredValue('MONGODB_URI');

if (isProduction && !configuredMongoUri) {
  throw new Error('MONGODB_URI must be explicitly configured in production.');
}

const clientUrl = normalizeOrigin(
  process.env.CLIENT_URL || 'http://localhost:5173',
  'CLIENT_URL'
);
const clientUrls = parseAdditionalOrigins(process.env.CLIENT_URLS);
const allowedOrigins = [...new Set([clientUrl, ...clientUrls])];
const allowedOriginSet = new Set(allowedOrigins);

const uploadDir = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || 'storage/uploads'
);
const sessionTtlHours = parseBoundedInteger(process.env.SESSION_TTL_HOURS, 8, {
  min: 1,
  max: 168,
  name: 'SESSION_TTL_HOURS',
});

function parseTrustProxy(value) {
  if (value === undefined || value === null || value === '') {
    return 1;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return 1;
  if (normalized === 'false') return 0;

  return parseBoundedInteger(value, 1, {
    min: 0,
    max: 10,
    name: 'TRUST_PROXY',
  });
}

module.exports = {
  port: parseBoundedInteger(process.env.PORT, 5000, {
    min: 1,
    max: 65535,
    name: 'PORT',
  }),
  nodeEnv,
  isProduction,
  isTest,
  mongodbUri: configuredMongoUri || 'mongodb://127.0.0.1:27017/sigap_ulp_labuhan',
  sanitizedMongodbUri: sanitizeMongoUri(
    configuredMongoUri || 'mongodb://127.0.0.1:27017/sigap_ulp_labuhan'
  ),
  clientUrl,
  clientUrls,
  allowedOrigins,
  isAllowedOrigin(origin) {
    return typeof origin === 'string' && allowedOriginSet.has(origin);
  },
  sessionSecret,
  sessionCookieName: 'sigap_session',
  csrfCookieName: 'sigap_csrf',
  sessionTtlHours,
  sessionTtlMs: sessionTtlHours * 60 * 60 * 1000,
  sessionLastUsedUpdateIntervalMs: parseBoundedInteger(
    process.env.SESSION_LAST_USED_UPDATE_INTERVAL_MS,
    5 * 60 * 1000,
    {
      min: 1000,
      max: 60 * 60 * 1000,
      name: 'SESSION_LAST_USED_UPDATE_INTERVAL_MS',
    }
  ),
  loginRateLimitWindowMs: parseBoundedInteger(
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000,
    {
      min: 1000,
      max: 24 * 60 * 60 * 1000,
      name: 'LOGIN_RATE_LIMIT_WINDOW_MS',
    }
  ),
  loginRateLimitLimit: parseBoundedInteger(
    process.env.LOGIN_RATE_LIMIT_MAX,
    10,
    {
      min: 1,
      max: 1000,
      name: 'LOGIN_RATE_LIMIT_MAX',
    }
  ),
  guestSyncRateLimitWindowMs: parseBoundedInteger(
    process.env.GUEST_SYNC_RATE_LIMIT_WINDOW_MS,
    60 * 1000,
    {
      min: 1000,
      max: 24 * 60 * 60 * 1000,
      name: 'GUEST_SYNC_RATE_LIMIT_WINDOW_MS',
    }
  ),
  guestSyncRateLimitLimit: parseBoundedInteger(
    process.env.GUEST_SYNC_RATE_LIMIT_MAX,
    10,
    {
      min: 1,
      max: 1000,
      name: 'GUEST_SYNC_RATE_LIMIT_MAX',
    }
  ),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
  urlencodedBodyLimit: process.env.URLENCODED_BODY_LIMIT || '100kb',
  // Export guards: a row ceiling alone does not bound the produced bytes, so
  // exports also have a hard output-byte ceiling and a concurrency ceiling.
  exportMaxBytes: parseBoundedInteger(process.env.EXPORT_MAX_BYTES, 64 * 1024 * 1024, {
    min: 1024 * 1024,
    max: 1024 * 1024 * 1024,
    name: 'EXPORT_MAX_BYTES',
  }),
  exportMaxConcurrent: parseBoundedInteger(process.env.EXPORT_MAX_CONCURRENT, 2, {
    min: 1,
    max: 64,
    name: 'EXPORT_MAX_CONCURRENT',
  }),
  maxAvatarBytes: 2 * 1024 * 1024,
  uploadDir,
  avatarUploadDir: path.join(uploadDir, 'avatars'),
  trustProxyHops: parseTrustProxy(process.env.TRUST_PROXY),
  googleFormUrl: process.env.GOOGLE_FORM_APPS_SCRIPT_URL || '',
};
