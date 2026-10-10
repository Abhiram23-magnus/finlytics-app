// ============================================================
// FINLYTICS — Environment configuration & validation
// ============================================================
'use strict';

const crypto = require('crypto');

class ConfigError extends Error {}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`Expected a non-negative integer, got "${value}"`);
  return n;
}

function parseTrustProxy(value, isVercel) {
  if (value === undefined || value === '') return isVercel ? 1 : false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  // e.g. "loopback", "10.0.0.0/8, 172.16.0.0/12"
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function parseOrigins(value) {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean).map(origin => {
    let url;
    try { url = new URL(origin); } catch { throw new ConfigError(`CORS_ORIGINS contains an invalid URL: ${origin}`); }
    if (url.origin !== origin) throw new ConfigError(`CORS_ORIGINS entries must be bare origins (scheme://host[:port]), got: ${origin}`);
    return origin;
  });
}

/**
 * Builds and validates configuration from an environment object.
 * Throws ConfigError with a readable message when something required is missing.
 * Never includes secret values in error messages.
 */
function loadConfig(env = process.env) {
  const nodeEnv      = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const isTest       = nodeEnv === 'test';
  const isVercel     = env.VERCEL === '1';
  const errors       = [];

  // ── Database ──
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) errors.push('DATABASE_URL is required (PostgreSQL connection string).');
  const sslMode = (env.DATABASE_SSL || (isProduction ? 'require' : 'disable')).toLowerCase();
  if (!['require', 'no-verify', 'disable'].includes(sslMode)) {
    errors.push('DATABASE_SSL must be one of: require, no-verify, disable.');
  }

  // ── Sessions ──
  let sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    if (isProduction) {
      errors.push('SESSION_SECRET is required in production.');
    } else {
      sessionSecret = crypto.randomBytes(32).toString('hex');
      if (!isTest) console.warn('  ⚠️  SESSION_SECRET not set — using a random secret; sessions reset on restart.');
    }
  } else if (sessionSecret.length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters (use e.g. `openssl rand -hex 32`).');
  } else if (isProduction && /secret|changeme|finlytics/i.test(sessionSecret)) {
    errors.push('SESSION_SECRET looks like a placeholder; generate a random value.');
  }

  // ── Public URL (used for password-reset links; never derived from the Host header) ──
  let appBaseUrl = env.APP_BASE_URL ? env.APP_BASE_URL.replace(/\/+$/, '') : '';
  if (appBaseUrl) {
    try {
      const u = new URL(appBaseUrl);
      if (isProduction && u.protocol !== 'https:') errors.push('APP_BASE_URL must use https in production.');
    } catch {
      errors.push('APP_BASE_URL is not a valid URL.');
    }
  }

  // ── Email (password recovery) ──
  const smtpHost = env.SMTP_HOST || '';
  const mailFrom = env.MAIL_FROM || '';
  const emailEnabled = Boolean(smtpHost && mailFrom && appBaseUrl);
  if (smtpHost && !mailFrom) errors.push('MAIL_FROM is required when SMTP_HOST is set.');
  if (smtpHost && !appBaseUrl) errors.push('APP_BASE_URL is required when SMTP_HOST is set (used to build reset links).');

  let corsOrigins = [];
  let trustProxy  = false;
  try { corsOrigins = parseOrigins(env.CORS_ORIGINS); } catch (e) { errors.push(e.message); }
  try { trustProxy  = parseTrustProxy(env.TRUST_PROXY, isVercel); } catch (e) { errors.push(e.message); }

  let numbers = {};
  try {
    numbers = {
      port:            int(env.PORT, 3000),
      dbPoolMax:       int(env.DB_POOL_MAX, isVercel ? 3 : 10),
      smtpPort:        int(env.SMTP_PORT, 587),
      resetTokenTtlMin: int(env.RESET_TOKEN_TTL_MINUTES, 30),
    };
  } catch (e) { errors.push(e.message); }

  if (errors.length) {
    throw new ConfigError('Invalid configuration:\n  - ' + errors.join('\n  - '));
  }

  return {
    nodeEnv, isProduction, isTest, isVercel,
    port: numbers.port,
    databaseUrl,
    databaseSsl: sslMode,
    dbPoolMax: numbers.dbPoolMax,
    sessionSecret,
    // __Host- prefix forces Secure, Path=/ and no Domain attribute (production only, needs HTTPS)
    sessionCookieName: isProduction ? '__Host-finlytics.sid' : 'finlytics.sid',
    sessionMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    secureCookies: isProduction || bool(env.SECURE_COOKIES),
    trustProxy,
    corsOrigins,
    appBaseUrl,
    demoMode: bool(env.DEMO_MODE, !isProduction),
    email: {
      enabled: emailEnabled,
      host: smtpHost,
      port: numbers.smtpPort,
      secure: bool(env.SMTP_SECURE, numbers.smtpPort === 465),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: mailFrom,
    },
    resetTokenTtlMs: numbers.resetTokenTtlMin * 60 * 1000,
    rateLimits: {
      enabled: !bool(env.DISABLE_RATE_LIMITS) || isProduction, // can never be disabled in production
      windowMs: 15 * 60 * 1000,
      login: int(env.RATE_LIMIT_LOGIN, 10),
      register: int(env.RATE_LIMIT_REGISTER, 5),
      passwordReset: int(env.RATE_LIMIT_PASSWORD_RESET, 5),
      api: int(env.RATE_LIMIT_API, 600),
    },
  };
}

module.exports = { loadConfig, ConfigError };
