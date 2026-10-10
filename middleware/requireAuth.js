// ============================================================
// FINLYTICS — Auth Middleware
// ============================================================
'use strict';

function requireAuth(req, res, next) {
  if (req.session && Number.isInteger(req.session.userId)) {
    return next();
  }
  return res.status(401).json({ error: 'Your session has expired. Please sign in again.', code: 'UNAUTHENTICATED' });
}

module.exports = requireAuth;
