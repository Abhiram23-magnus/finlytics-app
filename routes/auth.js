// ============================================================
// FINLYTICS — Auth Routes
// ============================================================
'use strict';

const express      = require('express');
const router       = express.Router();
const { Users }    = require('../db/database');

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, email, password, currency = 'USD' } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const existing = Users.findByEmail(email);
  if (existing)
    return res.status(409).json({ error: 'An account with that email already exists.' });

  const user = Users.create({ name, email, password, currency });
  req.session.userId   = user.id;
  req.session.userName = user.name;

  return res.status(201).json({
    message: 'Account created',
    user: { id: user.id, name: user.name, email: user.email, currency: user.currency }
  });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const user = Users.findByEmail(email);
  if (!user || !Users.verifyPassword(user, password))
    return res.status(401).json({ error: 'Invalid email or password.' });

  req.session.userId   = user.id;
  req.session.userName = user.name;

  return res.json({
    message: 'Logged in',
    user: { id: user.id, name: user.name, email: user.email, currency: user.currency, theme: user.theme }
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session?.userId)
    return res.status(401).json({ error: 'Not authenticated' });

  const user = Users.findById(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { password_hash, ...safe } = user;
  res.json(safe);
});

// PATCH /api/auth/preferences
router.patch('/preferences', (req, res) => {
  if (!req.session?.userId)
    return res.status(401).json({ error: 'Not authenticated' });

  Users.updatePrefs(req.session.userId, req.body);
  res.json({ message: 'Preferences updated' });
});

// ── Forgot Password (Mock 2-step without real email) ──────────

// POST /api/auth/find-account
router.post('/find-account', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = Users.findByEmail(email);
  if (!user) return res.status(404).json({ error: 'Account not found. Please check the spelling or register a new account.' });

  // Return just the name for confirmation
  res.json({ message: 'Account found', name: user.name });
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) return res.status(400).json({ error: 'Email and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const user = Users.findByEmail(email);
  if (!user) return res.status(404).json({ error: 'Account not found' });

  Users.updatePassword(user.id, newPassword);

  // Auto-login after reset
  req.session.userId   = user.id;
  req.session.userName = user.name;

  res.json({ message: 'Password updated and signed in' });
});

module.exports = router;
