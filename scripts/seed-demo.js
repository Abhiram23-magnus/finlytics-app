#!/usr/bin/env node
// ============================================================
// FINLYTICS — Seed a fictional demo account (local development / demos only)
// ============================================================
// Usage: npm run seed:demo      (refuses to run when NODE_ENV=production)
// Login: demo@finlytics.app / the DEMO_PASSWORD env var (default "demo1234")
'use strict';

require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { loadConfig } = require('../lib/config');
const { createPool, withTransaction } = require('../db/pool');
const { createRepository, shiftMonth, currentMonthUTC } = require('../db/repository');

const DEMO_EMAIL = 'demo@finlytics.app';

async function seedDemo(pool, { password = 'demo1234', month = currentMonthUTC() } = {}) {
  const repo = createRepository(pool);
  if (await repo.Users.findAuthByEmail(DEMO_EMAIL)) return { created: false };

  const user = await repo.Users.create({
    name: 'Alex Demo', email: DEMO_EMAIL, currency: 'USD',
    passwordHash: await bcrypt.hash(password, 12),
  });
  const p = n => shiftMonth(month, -n);
  const T = (type, merchant, category, amount, date, recurring = false, notes = '') =>
    ({ type, merchant, category, amount, date, notes, recurring });

  const txns = [
    T('income',  'Acme Corp — Salary', 'Salary',        6200,   `${month}-01`, true, 'Monthly salary'),
    T('expense', 'Green Grocer',       'Food',          87.40,  `${month}-03`),
    T('expense', 'StreamFlix',         'Entertainment', 15.99,  `${month}-01`, true),
    T('expense', 'City Cab',           'Transport',     22.50,  `${month}-02`, false, 'Airport ride'),
    T('expense', 'Gadget Hub',         'Shopping',      299.00, `${month}-03`, false, 'Headphones'),
    T('expense', 'Metro Power & Light','Bills',         134.00, `${month}-02`, true),
    T('expense', 'Corner Café',        'Food',          6.75,   `${month}-02`, false, 'Morning coffee'),
    T('expense', 'FitLife Gym',        'Health',        25.00,  `${month}-02`, true),
  ];
  const monthly = [[1, 5800, 320, 60, 220], [2, 6200, 380, 0, 340], [3, 5800, 290, 110, 0], [4, 6200, 410, 0, 0], [5, 5900, 350, 0, 480]];
  for (const [n, salary, food, transport, shopping] of monthly) {
    txns.push(T('income',  'Acme Corp — Salary', 'Salary', salary, `${p(n)}-01`, true));
    txns.push(T('expense', 'Sunrise Apartments', 'Bills',  1800,   `${p(n)}-05`, true, 'Rent'));
    txns.push(T('expense', 'Green Grocer',       'Food',   food,   `${p(n)}-10`));
    if (transport) txns.push(T('expense', 'Fuel Stop', 'Transport', transport, `${p(n)}-15`));
    if (shopping)  txns.push(T('expense', 'Online Mart', 'Shopping', shopping, `${p(n)}-20`));
  }
  txns.push(T('expense', 'SkyHigh Airlines', 'Travel',    890, `${p(2)}-18`));
  txns.push(T('income',  'Freelance Project','Freelance', 600, `${p(3)}-20`));
  txns.push(T('expense', 'Beach Getaway',    'Travel',   1200, `${p(4)}-20`, false, 'Spring break'));

  await withTransaction(pool, async client => {
    for (const t of txns) {
      await client.query(
        `INSERT INTO transactions (user_id, type, merchant, category, amount, date, notes, recurring)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [user.id, t.type, t.merchant, t.category, t.amount, t.date, t.notes, t.recurring]);
    }
    const budgets = [['Food', 600], ['Transport', 200], ['Shopping', 400], ['Bills', 350], ['Entertainment', 100], ['Health', 150], ['Travel', 1500], ['Education', 200]];
    for (const [category, limit] of budgets) {
      await client.query(
        `INSERT INTO budgets (user_id, category, limit_amount, emoji, color)
         SELECT $1, name, $3, emoji, color FROM categories WHERE user_id = $1 AND type = 'expense' AND name = $2`,
        [user.id, category, limit]);
    }
    await client.query('INSERT INTO monthly_budgets (user_id, month, amount) VALUES ($1,$2,5000)', [user.id, month]);
  });
  return { created: true, userId: user.id };
}

module.exports = { seedDemo, DEMO_EMAIL };

if (require.main === module) {
  (async () => {
    const config = loadConfig();
    if (config.isProduction && !process.argv.includes('--allow-production')) {
      throw new Error('Refusing to seed demo data in production (pass --allow-production to override).');
    }
    const pool = createPool(config);
    try {
      const r = await seedDemo(pool, { password: process.env.DEMO_PASSWORD || 'demo1234' });
      console.log(r.created ? `  ✅  Demo account created (${DEMO_EMAIL}).` : '  Demo account already exists; nothing changed.');
    } finally {
      await pool.end();
    }
  })().catch(err => { console.error('  ❌ ', err.message); process.exit(1); });
}
