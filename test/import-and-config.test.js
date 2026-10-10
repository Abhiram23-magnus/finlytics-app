'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { resetDatabase, testConfig, makeApp, closeApp, Client, TEST_DATABASE_URL } = require('./helpers');
const { createPool } = require('../db/pool');
const { importData } = require('../scripts/import-json');
const { seedDemo } = require('../scripts/seed-demo');
const { loadConfig } = require('../lib/config');

const sample = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db', 'demo-data.example.json'), 'utf8'));
const quiet = { log: () => {} };

describe('legacy JSON → PostgreSQL import', () => {
  before(resetDatabase);

  test('dry run writes nothing', async () => {
    const pool = createPool(testConfig());
    try {
      const stats = await importData(pool, sample(), { dryRun: true, ...quiet });
      assert.equal(stats.users, 1);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
      assert.equal(rows[0].n, 0);
    } finally { await pool.end(); }
  });

  test('imports valid records, skips invalid ones, preserves password hashes, and is safe to re-run', async () => {
    const pool = createPool(testConfig());
    try {
      const data = sample();
      data.users[0].password_hash = bcrypt.hashSync('legacy-password', 4);
      const stats = await importData(pool, data, quiet);
      assert.equal(stats.users, 1);
      assert.equal(stats.transactions, 3);
      assert.equal(stats.transactionsSkipped, 1, 'negative amount / impossible date is skipped');
      assert.equal(stats.budgets, 1);
      assert.equal(stats.monthlyBudgets, 1);
      const cats = await pool.query("SELECT name FROM categories WHERE type = 'expense' ORDER BY name");
      assert.ok(cats.rows.some(r => r.name === 'Education'), 'missing categories referenced by transactions are created');

      const again = await importData(pool, sample(), quiet);
      assert.equal(again.users, 0);
      assert.equal(again.usersSkipped, 1, 'existing emails are never overwritten');
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM transactions');
      assert.equal(rows[0].n, 3);
    } finally { await pool.end(); }

    const app = makeApp();
    try {
      const c = new Client(app);
      assert.equal((await c.post('/api/auth/login', { email: 'sam@example.com', password: 'legacy-password' })).status, 200);
      const s = await c.body('/api/analytics/summary?month=2026-02');
      assert.equal(s.monthlyIncome, 3200);
      assert.equal(s.monthlyExpenses, 73.29);
    } finally { await closeApp(app); }
  });

  test('demo seed creates fictional data once', async () => {
    const pool = createPool(testConfig());
    try {
      assert.equal((await seedDemo(pool, { password: 'demo-pass-123' })).created, true);
      assert.equal((await seedDemo(pool, { password: 'demo-pass-123' })).created, false);
    } finally { await pool.end(); }
  });
});

describe('configuration validation', () => {
  const base = { DATABASE_URL: TEST_DATABASE_URL };

  test('production requires a strong SESSION_SECRET', () => {
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), /SESSION_SECRET is required/);
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'short' }), /at least 32/);
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'finlytics-secret-finlytics-secret-xx' }), /placeholder/);
  });

  test('DATABASE_URL is always required', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'development' }), /DATABASE_URL is required/);
  });

  test('email recovery needs MAIL_FROM and APP_BASE_URL; https in production', () => {
    assert.throws(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.com' }), /MAIL_FROM is required/);
    assert.throws(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'a@b.c' }), /APP_BASE_URL is required/);
    const ok = loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'a@b.c', APP_BASE_URL: 'http://localhost:3000/' });
    assert.equal(ok.email.enabled, true);
    assert.equal(ok.appBaseUrl, 'http://localhost:3000');
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(64), APP_BASE_URL: 'http://x.example' }), /https/);
  });

  test('production defaults are secure', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'a1b2'.repeat(16), VERCEL: '1', DISABLE_RATE_LIMITS: 'true' });
    assert.equal(c.secureCookies, true);
    assert.equal(c.sessionCookieName, '__Host-finlytics.sid');
    assert.equal(c.trustProxy, 1);
    assert.equal(c.databaseSsl, 'require');
    assert.equal(c.demoMode, false);
    assert.equal(c.rateLimits.enabled, true, 'rate limits cannot be disabled in production');
    assert.equal(c.email.enabled, false);
  });

  test('CORS origins must be exact origins', () => {
    assert.throws(() => loadConfig({ ...base, CORS_ORIGINS: 'https://a.example/path' }), /bare origins/);
    assert.deepEqual(loadConfig({ ...base, CORS_ORIGINS: 'https://a.example, http://localhost:5173' }).corsOrigins,
      ['https://a.example', 'http://localhost:5173']);
  });
});
