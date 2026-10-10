// ============================================================
// FINLYTICS — CSRF protection (synchronizer token, session-bound)
// ============================================================
// The token lives in the server-side session and must be echoed back in the
// X-CSRF-Token header on every state-changing request. A cross-site attacker
// can neither read the token nor set custom headers on a cross-origin request
// without passing CORS, which is restricted to trusted origins.
'use strict';

const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function issueCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  }
  return req.session.csrfToken;
}

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session && req.session.csrfToken;
  const provided = req.get('x-csrf-token');
  if (!expected || !tokensMatch(expected, provided)) {
    return res.status(403).json({ error: 'Your security token is missing or expired. Please retry.', code: 'CSRF_INVALID' });
  }
  return next();
}

module.exports = { csrfProtection, issueCsrfToken };
