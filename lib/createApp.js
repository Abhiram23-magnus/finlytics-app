// ============================================================
// FINLYTICS — Express application factory
// ============================================================
'use strict';

const express     = require('express');
const session     = require('express-session');
const PgSession   = require('connect-pg-simple')(session);
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const { createPool }       = require('../db/pool');
const { createRepository } = require('../db/repository');
const { createMailer }     = require('./mailer');
const { PgRateLimitStore } = require('./rateLimitStore');
const { csrfProtection }   = require('../middleware/csrf');
const { notFound, errorHandler } = require('../middleware/errorHandler');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function buildLimiters(config, pool) {
  const make = (name, limit, extra = {}) => {
    if (!config.rateLimits.enabled) return (req, res, next) => next();
    return rateLimit({
      windowMs: config.rateLimits.windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      store: new PgRateLimitStore(pool, name),
      // If the counter store is unreachable, fail closed for auth endpoints.
      passOnStoreError: false,
      handler: (req, res) => res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.', code: 'RATE_LIMITED' }),
      ...extra,
    });
  };
  return {
    // Only failed sign-ins count, so legitimate users are not locked out.
    login:         make('login', config.rateLimits.login, { skipSuccessfulRequests: true }),
    register:      make('register', config.rateLimits.register),
    passwordReset: make('pwreset', config.rateLimits.passwordReset),
    api:           make('api', config.rateLimits.api, { windowMs: 60 * 1000 }),
  };
}

/**
 * Creates the Express app. Dependencies can be injected for tests:
 *   createApp({ config, pool?, mailer? })
 * Returns the app with `app.locals.pool` for shutdown.
 */
function createApp({ config, pool, mailer } = {}) {
  if (!config) throw new Error('createApp requires a config object');
  pool   = pool   || createPool(config);
  mailer = mailer || createMailer(config);
  const repo     = createRepository(pool);
  const limiters = buildLimiters(config, pool);
  const deps     = { repo, config, mailer, limiters, pool };

  const app = express();
  app.locals.pool = pool;
  app.disable('x-powered-by');
  // Needed so req.ip / req.secure reflect the client when behind Vercel or another proxy.
  app.set('trust proxy', config.trustProxy);

  // ── Security headers & CSP ─────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src':  ["'self'"],
        'script-src-attr': ["'none'"],
        // Static markup still uses style="" attributes; no user data reaches CSS.
        'style-src':   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src':    ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src':     ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src':  ["'none'"],
        'base-uri':    ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.isProduction ? [] : null,
      },
    },
    strictTransportSecurity: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' }, // reset tokens appear in the URL
    crossOriginEmbedderPolicy: false,
  }));
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });

  // ── Static frontend (before sessions: assets never touch the DB) ──
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: config.isProduction ? '1h' : 0 }));

  // ── CORS: only explicitly trusted origins (same-origin needs none) ──
  if (config.corsOrigins.length) {
    app.use('/api', cors({
      origin(origin, cb) {
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        const err = new Error('Origin not allowed'); err.status = 403; err.code = 'CORS_REJECTED';
        return cb(err);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    }));
  }

  // ── Body parsing with tight limits ─────────────────────────
  app.use('/api', express.json({ limit: '16kb', strict: true, type: 'application/json' }));

  // ── Sessions (stored in PostgreSQL; shared by all instances) ──
  app.use(session({
    name: config.sessionCookieName,
    store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false, pruneSessionInterval: config.isVercel || config.isTest ? false : 15 * 60 }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    proxy: Boolean(config.trustProxy),
    cookie: {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionMaxAgeMs,
    },
  }));

  // ── API ───────────────────────────────────────────────────
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', limiters.api);
  app.use('/api', csrfProtection);
  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.use('/api/auth',         require('../routes/auth')(deps));
  app.use('/api/transactions', require('../routes/transactions')(deps));
  app.use('/api/budgets',      require('../routes/budgets')(deps));
  app.use('/api/analytics',    require('../routes/analytics')(deps));
  app.use('/api/categories',   require('../routes/categories')(deps));
  app.use('/api', notFound);

  // Page routes: dashboard for signed-in users, login page otherwise.
  app.get(['/', '/index.html'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, req.session.userId ? 'index.html' : 'login.html'));
  });
  app.get('/login.html', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
