// ============================================================
// FINLYTICS — Auth Routes
// ============================================================
'use strict';

const express     = require('express');
const crypto      = require('crypto');
const bcrypt      = require('bcryptjs');
const requireAuth = require('../middleware/requireAuth');
const { issueCsrfToken } = require('../middleware/csrf');
const v           = require('../lib/validation');

const BCRYPT_COST = 12;
// Compared against when the email is unknown, so response time does not reveal
// whether an account exists.
const DUMMY_HASH  = bcrypt.hashSync('finlytics-timing-equalizer', BCRYPT_COST);

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, currency: u.currency, theme: u.theme };
}

/** Starts a fresh session for the user (prevents session fixation). */
async function signIn(req, user) {
  await regenerate(req);
  req.session.userId = user.id;
  return issueCsrfToken(req);
}

module.exports = function authRoutes({ repo, config, mailer, limiters }) {
  const router = express.Router();

  // Public client configuration (no secrets)
  router.get('/config', (req, res) => {
    res.json({ demoEnabled: config.demoMode, passwordResetEnabled: mailer.enabled });
  });

  // CSRF token for the current session (anonymous or signed in)
  router.get('/csrf', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken: issueCsrfToken(req) });
  });

  // POST /api/auth/register
  router.post('/register', limiters.register, async (req, res) => {
    const b        = v.body(req);
    const name     = v.text(b.name, 'name', { max: 100 });
    const email    = v.email(b.email);
    const password = v.newPassword(b.password);
    const currency = v.oneOf(b.currency || 'USD', 'currency', v.CURRENCIES);

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await repo.Users.create({ name, email, passwordHash, currency });
    if (!user) return res.status(409).json({ error: 'An account with that email already exists.' });

    const csrfToken = await signIn(req, user);
    return res.status(201).json({ message: 'Account created', user: publicUser(user), csrfToken });
  });

  // POST /api/auth/login
  router.post('/login', limiters.login, async (req, res) => {
    const b = v.body(req);
    if (typeof b.email !== 'string' || typeof b.password !== 'string' || !b.email || !b.password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (b.email.length > 254 || b.password.length > 1024) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = await repo.Users.findAuthByEmail(b.email.trim().toLowerCase());
    const ok   = await bcrypt.compare(b.password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password.' });

    const csrfToken = await signIn(req, user);
    return res.json({ message: 'Logged in', user: publicUser(user), csrfToken });
  });

  // POST /api/auth/logout
  router.post('/logout', (req, res, next) => {
    req.session.destroy(err => {
      if (err) return next(err);
      res.clearCookie(config.sessionCookieName, { path: '/', httpOnly: true, secure: config.secureCookies, sameSite: 'lax' });
      return res.json({ message: 'Logged out' });
    });
  });

  // GET /api/auth/me
  router.get('/me', requireAuth, async (req, res) => {
    const user = await repo.Users.findById(req.session.userId);
    if (!user) {
      // Account no longer exists — end the orphaned session.
      return req.session.destroy(() => res.status(401).json({ error: 'Your session has expired. Please sign in again.', code: 'UNAUTHENTICATED' }));
    }
    const transactionCount = await repo.Transactions.count(user.id);
    res.set('Cache-Control', 'no-store');
    return res.json({ ...publicUser(user), transactionCount });
  });

  // PATCH /api/auth/preferences
  router.patch('/preferences', requireAuth, async (req, res) => {
    const b = v.body(req);
    const updates = {};
    if (b.currency !== undefined) updates.currency = v.oneOf(b.currency, 'currency', v.CURRENCIES);
    if (b.theme    !== undefined) updates.theme    = v.oneOf(b.theme, 'theme', v.THEMES);
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });

    const user = await repo.Users.updatePrefs(req.session.userId, updates);
    return res.json({ message: 'Preferences updated', user: publicUser(user) });
  });

  // ── Password recovery (email-based, single-use expiring token) ──

  function requireEmail(req, res, next) {
    if (!mailer.enabled) {
      return res.status(503).json({ error: 'Password recovery is not available. Please contact support.', code: 'RESET_DISABLED' });
    }
    return next();
  }

  // POST /api/auth/forgot-password  { email }
  router.post('/forgot-password', limiters.passwordReset, requireEmail, async (req, res) => {
    const email = v.email(v.body(req).email);
    const generic = { message: 'If an account exists for that email, a reset link has been sent.' };

    const user = await repo.Users.findAuthByEmail(email);
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      await repo.ResetTokens.create(user.id, sha256(token), config.resetTokenTtlMs);
      const link = `${config.appBaseUrl}/login.html?reset=${encodeURIComponent(token)}`;
      try {
        await mailer.sendPasswordReset(user.email, user.name, link, Math.round(config.resetTokenTtlMs / 60000));
      } catch (err) {
        // Do not reveal delivery failures (would confirm the account exists).
        console.error('[mail] password reset delivery failed:', err.code || err.message);
      }
    }
    return res.status(202).json(generic);
  });

  // POST /api/auth/reset-password  { token, newPassword }
  router.post('/reset-password', limiters.passwordReset, requireEmail, async (req, res) => {
    const b = v.body(req);
    if (typeof b.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.token)) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.', code: 'RESET_TOKEN_INVALID' });
    }
    const password = v.newPassword(b.newPassword, 'newPassword');
    const hash = await bcrypt.hash(password, BCRYPT_COST);

    const userId = await repo.ResetTokens.consumeAndResetPassword(sha256(b.token), hash);
    if (!userId) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.', code: 'RESET_TOKEN_INVALID' });
    }
    // Start clean: the requester must sign in with the new password.
    await regenerate(req);
    return res.json({ message: 'Password updated. Please sign in with your new password.' });
  });

  return router;
};
