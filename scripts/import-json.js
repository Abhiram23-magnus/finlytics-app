#!/usr/bin/env node
// ============================================================
// FINLYTICS — One-time import from the legacy lowdb JSON file into PostgreSQL
// ============================================================
// Usage:
//   node scripts/import-json.js <path/to/finlytics.json> [--dry-run]
//
// * Runs in a single transaction: either everything is imported or nothing is.
// * --dry-run performs the whole import and then rolls back.
// * Users whose email already exists in the database are skipped together with
//   their records (no overwrites). Existing bcrypt hashes are preserved so
//   people keep their passwords.
// * Records that fail validation are skipped and counted; their contents are
//   never printed (they contain personal financial data).
'use strict';

require('dotenv').config({ quiet: true });
const fs     = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { loadConfig } = require('../lib/config');
const { createPool, withTransaction } = require('../db/pool');
const { pendingMigrations } = require('../db/migrate');
const { DEFAULT_CATEGORIES } = require('../db/repository');
const v = require('../lib/validation');

function attempt(fn) {
  try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, reason: e.message }; }
}

async function importData(pool, data, { dryRun = false, log = console.log } = {}) {
  const stats = { users: 0, usersSkipped: 0, categories: 0, transactions: 0, transactionsSkipped: 0,
                  budgets: 0, budgetsSkipped: 0, monthlyBudgets: 0, monthlyBudgetsSkipped: 0, skipReasons: {} };
  const skip = (kind, reason) => {
    stats[kind + 'Skipped']++;
    const key = `${kind}: ${reason}`;
    stats.skipReasons[key] = (stats.skipReasons[key] || 0) + 1;
  };

  const collections = ['users', 'categories', 'transactions', 'budgets', 'monthly_budgets'];
  for (const c of collections) {
    if (data[c] !== undefined && !Array.isArray(data[c])) throw new Error(`"${c}" must be an array`);
    data[c] = data[c] || [];
  }

  const ROLLBACK = Symbol('dry-run');
  try {
    await withTransaction(pool, async client => {
      const idMap = new Map(); // legacy user id → new user id

      for (const u of data.users) {
        const parsed = attempt(() => ({
          name: v.text(u.name, 'name', { max: 100 }),
          email: v.email(u.email),
          currency: v.CURRENCIES.includes(u.currency) ? u.currency : 'USD',
          theme: v.THEMES.includes(u.theme) ? u.theme : 'dark',
        }));
        if (!parsed.ok) { skip('users', 'invalid user record'); continue; }
        const hash = typeof u.password_hash === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(u.password_hash)
          ? u.password_hash
          // No usable hash: set a random one; the person must use password recovery.
          : bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
        const createdAt = !Number.isNaN(Date.parse(u.created_at)) ? u.created_at : new Date().toISOString();
        const { rows } = await client.query(
          `INSERT INTO users (name, email, password_hash, currency, theme, created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING RETURNING id`,
          [parsed.value.name, parsed.value.email, hash, parsed.value.currency, parsed.value.theme, createdAt]);
        if (!rows[0]) { skip('users', 'email already exists in database'); continue; }
        idMap.set(u.id, rows[0].id);
        stats.users++;
      }

      const ensureCategory = async (userId, type, name, emoji, color) => {
        const { rowCount } = await client.query(
          `INSERT INTO categories (user_id, type, name, emoji, color) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [userId, type, name, emoji, color]);
        stats.categories += rowCount;
      };

      for (const c of data.categories) {
        const userId = idMap.get(c.user_id);
        if (!userId) continue;
        const p = attempt(() => ({
          type: v.oneOf(c.type, 'type', v.TXN_TYPES),
          name: v.text(c.name, 'name', { max: 40 }),
          emoji: attempt(() => v.emoji(c.emoji)).value || '🏷',
          color: attempt(() => v.color(c.color)).value || '#10B981',
        }));
        if (p.ok) await ensureCategory(userId, p.value.type, p.value.name, p.value.emoji, p.value.color);
      }
      // Users that never had categories get the defaults.
      for (const userId of idMap.values()) {
        const { rows } = await client.query('SELECT count(*)::int AS n FROM categories WHERE user_id = $1', [userId]);
        if (rows[0].n === 0) {
          for (const d of DEFAULT_CATEGORIES) await ensureCategory(userId, d.type, d.name, d.emoji, d.color);
        }
      }

      for (const t of data.transactions) {
        const userId = idMap.get(t.user_id);
        if (!userId) { skip('transactions', 'owner not imported'); continue; }
        const p = attempt(() => ({
          type: v.oneOf(t.type, 'type', v.TXN_TYPES),
          merchant: v.text(t.merchant, 'merchant', { max: 100 }),
          category: v.text(t.category, 'category', { max: 40 }),
          amount: v.amount(t.amount),
          date: v.date(t.date),
          notes: v.multiline(t.notes, 'notes', { max: 500 }),
          recurring: Boolean(t.recurring),
        }));
        if (!p.ok) { skip('transactions', p.reason); continue; }
        const x = p.value;
        await ensureCategory(userId, x.type, x.category, '🏷', '#64748B');
        const createdAt = !Number.isNaN(Date.parse(t.created_at)) ? t.created_at : new Date().toISOString();
        await client.query(
          `INSERT INTO transactions (user_id, type, merchant, category, amount, date, notes, recurring, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [userId, x.type, x.merchant, x.category, x.amount, x.date, x.notes, x.recurring, createdAt]);
        stats.transactions++;
      }

      for (const b of data.budgets) {
        const userId = idMap.get(b.user_id);
        if (!userId) { skip('budgets', 'owner not imported'); continue; }
        const p = attempt(() => ({
          category: v.text(b.category, 'category', { max: 40 }),
          limit: v.amount(b.limit_amount, 'limit_amount'),
          emoji: attempt(() => v.emoji(b.emoji, 'emoji', '💳')).value || '💳',
          color: attempt(() => v.color(b.color)).value || '#6366F1',
        }));
        if (!p.ok) { skip('budgets', p.reason); continue; }
        await ensureCategory(userId, 'expense', p.value.category, p.value.emoji, p.value.color);
        const { rowCount } = await client.query(
          `INSERT INTO budgets (user_id, category, limit_amount, emoji, color) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (user_id, lower(category)) DO NOTHING`,
          [userId, p.value.category, p.value.limit, p.value.emoji, p.value.color]);
        if (rowCount) stats.budgets++; else skip('budgets', 'duplicate category budget');
      }

      for (const m of data.monthly_budgets) {
        const userId = idMap.get(m.user_id);
        if (!userId) { skip('monthlyBudgets', 'owner not imported'); continue; }
        const p = attempt(() => ({ month: v.month(m.month), amount: v.amount(m.amount) }));
        if (!p.ok) { skip('monthlyBudgets', p.reason); continue; }
        const { rowCount } = await client.query(
          `INSERT INTO monthly_budgets (user_id, month, amount) VALUES ($1,$2,$3) ON CONFLICT (user_id, month) DO NOTHING`,
          [userId, p.value.month, p.value.amount]);
        if (rowCount) stats.monthlyBudgets++; else skip('monthlyBudgets', 'duplicate month');
      }

      if (dryRun) throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  log(`${dryRun ? '[dry run — nothing written] ' : ''}Import summary:`);
  log(JSON.stringify(stats, null, 2));
  return stats;
}

module.exports = { importData };

if (require.main === module) {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!file) {
    console.error('Usage: node scripts/import-json.js <path/to/finlytics.json> [--dry-run]');
    process.exit(1);
  }
  (async () => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pool = createPool(loadConfig());
    try {
      if ((await pendingMigrations(pool)).length) throw new Error('Run `npm run migrate` before importing.');
      await importData(pool, data, { dryRun });
    } finally {
      await pool.end();
    }
  })().catch(err => { console.error('  ❌  Import failed (nothing was written):', err.message); process.exit(1); });
}
