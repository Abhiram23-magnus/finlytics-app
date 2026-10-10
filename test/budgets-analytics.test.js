'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, makeApp, closeApp, Client } = require('./helpers');
const { shiftMonth } = require('../db/repository');

const M = '2026-06';
const T = (type, category, amount, date, merchant = 'x') => ({ type, category, amount, date, merchant });

describe('budgets, monthly summaries and analytics', () => {
  let app, c;
  before(async () => {
    await resetDatabase(); app = makeApp(); c = new Client(app); await c.register();
    const txns = [
      T('income', 'Salary', 5000, `${M}-01`), T('income', 'Freelance', 0.1, `${M}-02`), T('income', 'Freelance', 0.2, `${M}-03`),
      T('expense', 'Food', 100.10, `${M}-05`), T('expense', 'Food', 49.95, `${M}-05`), T('expense', 'Bills', 1200, `${M}-30`),
      T('expense', 'Food', 75, `${shiftMonth(M, -1)}-15`), T('income', 'Salary', 4000, `${shiftMonth(M, -1)}-01`),
      T('expense', 'Travel', 300, `${shiftMonth(M, -6)}-10`), // outside the 6-month trend window
      T('expense', 'Food', 10, `${shiftMonth(M, 1)}-01`),     // next month
    ];
    for (const t of txns) assert.equal((await c.post('/api/transactions', t)).status, 201);
  });
  after(() => closeApp(app));

  test('summary: balance, monthly totals, savings rate (exact cents)', async () => {
    const s = await c.body(`/api/analytics/summary?month=${M}`);
    assert.equal(s.monthlyIncome, 5000.3, '0.1 + 0.2 must be exactly 0.30');
    assert.equal(s.monthlyExpenses, 1350.05);
    assert.equal(s.monthlyNet, 3650.25);
    assert.equal(s.savingsRate, Math.round((3650.25 / 5000.3) * 100));
    assert.equal(s.totalIncome, 9000.3);
    assert.equal(s.totalExpenses, 1735.05);
    assert.equal(s.balance, 7265.25);
  });

  test('savings rate is null (not 0%) when there is no income', async () => {
    const s = await c.body('/api/analytics/summary?month=2020-01');
    assert.equal(s.savingsRate, null);
    assert.equal(s.monthlyIncome, 0);
  });

  test('trends cover exactly the 6 months ending at the given month', async () => {
    const t = await c.body(`/api/analytics/trends?month=${M}`);
    assert.equal(t.length, 6);
    assert.equal(t[5].key, M);
    assert.equal(t[0].key, shiftMonth(M, -5));
    assert.equal(t[5].income, 5000.3);
    assert.equal(t[4].expenses, 75);
    assert.equal(t.reduce((s, x) => s + x.expenses, 0), 1350.05 + 75, 'excludes out-of-window months');
    assert.equal(t[5].month, 'Jun');
  });

  test('category breakdown and heatmap', async () => {
    const cats = await c.body(`/api/analytics/categories?month=${M}`);
    assert.deepEqual(cats, [{ category: 'Bills', total: 1200 }, { category: 'Food', total: 150.05 }]);
    const heat = await c.body(`/api/analytics/heatmap?month=${M}`);
    assert.deepEqual(heat, [{ date: `${M}-05`, total: 150.05 }, { date: `${M}-30`, total: 1200 }]);
    assert.equal((await c.get('/api/analytics/summary?month=2026-13')).status, 400);
  });

  test('category budgets: utilization, case-insensitive upsert, validation', async () => {
    const b1 = await c.post('/api/budgets', { category: 'Food', limit_amount: 200 });
    assert.equal(b1.status, 201);
    const b2 = await c.post('/api/budgets', { category: 'food', limit_amount: 250 });
    assert.equal(b2.status, 201);
    assert.equal(b2.body.id, b1.body.id, 'same category updates instead of duplicating');

    const list = await c.body(`/api/budgets?month=${M}`);
    assert.equal(list.length, 1);
    assert.equal(list[0].limit_amount, 250);
    assert.equal(list[0].spent, 150.05);
    assert.equal(list[0].category, 'Food');

    for (const body of [{ category: 'Food', limit_amount: -5 }, { category: 'Food', limit_amount: 0 }, { category: 'Food', limit_amount: 'lots' },
                        { category: 'Salary', limit_amount: 10 }, { category: 'Nope', limit_amount: 10 }, { limit_amount: 10 }]) {
      assert.equal((await c.post('/api/budgets', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await c.del(`/api/budgets/${b1.body.id}`)).status, 200);
    assert.equal((await c.body('/api/budgets')).length, 0);
  });

  test('monthly overall budget: upsert per month and validation', async () => {
    assert.equal((await c.post('/api/budgets/monthly', { month: M, amount: 3000 })).status, 201);
    assert.equal((await c.post('/api/budgets/monthly', { month: M, amount: '3500.50' })).status, 201);
    assert.equal((await c.body(`/api/budgets/monthly?month=${M}`)).budget.amount, 3500.5);
    for (const body of [{ month: '2026-6', amount: 1 }, { month: M, amount: -1 }, { month: M, amount: 'x' }, { month: M }]) {
      assert.equal((await c.post('/api/budgets/monthly', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await c.get('/api/budgets/monthly')).status, 400);
  });
});

describe('categories', () => {
  let app, c;
  before(async () => { await resetDatabase(); app = makeApp(); c = new Client(app); await c.register(); });
  after(() => closeApp(app));

  test('create, reject duplicates (case-insensitive), delete', async () => {
    const res = await c.post('/api/categories', { type: 'expense', name: 'Subscriptions', emoji: '📺', color: '#3B82F6' });
    assert.equal(res.status, 201);
    assert.equal((await c.post('/api/categories', { type: 'expense', name: 'subscriptions' })).status, 409);
    assert.equal((await c.post('/api/categories', { type: 'income', name: 'Subscriptions' })).status, 201, 'same name allowed for the other type');
    assert.equal((await c.post('/api/categories', { type: 'bogus', name: 'X' })).status, 400);
    assert.equal((await c.post('/api/categories', { type: 'expense', name: 'x'.repeat(41) })).status, 400);
    assert.equal((await c.get('/api/categories?type=bogus')).status, 400);
    assert.ok((await c.body('/api/categories?type=income')).every(x => x.type === 'income'));

    // Transactions keep their category label after the category is deleted
    await c.post('/api/transactions', { type: 'expense', category: 'Subscriptions', merchant: 'TV', amount: 9.99, date: '2026-01-05' });
    assert.equal((await c.del(`/api/categories/${res.body.id}`)).status, 200);
    assert.equal((await c.del(`/api/categories/${res.body.id}`)).status, 404);
    assert.equal((await c.body('/api/transactions'))[0].category, 'Subscriptions');
  });
});
