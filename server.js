// ============================================================
// FINLYTICS — Express Server Entry Point
// ============================================================
'use strict';

require('dotenv').config();
const express       = require('express');
const session       = require('express-session');
const cors          = require('cors');
const path          = require('path');
const { initDb }    = require('./db/database');

const authRoutes         = require('./routes/auth');
const transactionRoutes  = require('./routes/transactions');
const budgetRoutes       = require('./routes/budgets');
const analyticsRoutes    = require('./routes/analytics');
const categoriesRoutes   = require('./routes/categories');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'finlytics-secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   false,           // set true behind HTTPS in production
    httpOnly: true,
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ── Static files ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/budgets',      budgetRoutes);
app.use('/api/analytics',    analyticsRoutes);
app.use('/api/categories',   categoriesRoutes);

// ── SPA Fallback ──────────────────────────────────────────────
// Any non-API GET request returns the SPA (or login page)
app.get('*', (req, res) => {
  if (req.session?.userId) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

// ── 404 / Error Handlers ──────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ───────────────────────────────────────────────────
initDb();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🚀  Finlytics running at http://localhost:${PORT}`);
  console.log(`  🌐  Or access via http://127.0.0.1:${PORT}\n`);
});

// Export for Vercel
module.exports = app;
