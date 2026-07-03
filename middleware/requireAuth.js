// ============================================================
// FINLYTICS — Auth Middleware
// ============================================================
'use strict';

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized — please log in' });
}

module.exports = requireAuth;
