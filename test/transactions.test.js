'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, makeApp, closeApp, Client } = require('./helpers');

const valid = { type: 'expense', merchant: 'Corner Shop', category: 'Food', amount: 12.5, date: '2026-03-14', notes: 'milk' };

describe('transactions CRUD', () => {
  let app, c;
  before(async () => { await resetDatabase(); app = makeApp(); c = new Client(app); await c.register(); });
  after(() => closeApp(app));

  test('create, read, update, delete', async () => {
    const created = await c.post('/api/transactions', valid);
    assert.equal(created.status, 201);
    const t = created.body;
    assert.equal(t.amount, 12.5);
    assert.equal(t.date, '2026-03-14');
    assert.equal(t.recurring, false);
    assert.equal(t.user_id, undefined);

    assert.deepEqual((await c.body(`/api/transactions/${t.id}`)).merchant, 'Corner Shop');
    assert.ok((await c.body('/api/transactions')).some(x => x.id === t.id));

    const upd = await c.put(`/api/transactions/${t.id}`, { amount: '20.10', merchant: '  Big Shop  ' });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.amount, 20.1);
    assert.equal(upd.body.merchant, 'Big Shop');
    assert.equal(upd.body.category, 'Food', 'omitted fields keep their value');

    const typeChange = await c.put(`/api/transactions/${t.id}`, { type: 'income', category: 'Salary' });
    assert.equal(typeChange.status, 200);
    const badCombo = await c.put(`/api/transactions/${t.id}`, { category: 'Food' }); // Food is an expense category
    assert.equal(badCombo.status, 400);

    assert.equal((await c.del(`/api/transactions/${t.id}`)).status, 200);
    assert.equal((await c.get(`/api/transactions/${t.id}`)).status, 404);
    assert.equal((await c.del(`/api/transactions/${t.id}`)).status, 404);
  });

  test('rejects invalid amounts', async () => {
    for (const amount of [-1, 0, '0', 'abc', 'Infinity', '1e5', 'NaN', null, '', 12.345, 1e12, '12,50', [], {}, true]) {
      const res = await c.post('/api/transactions', { ...valid, amount });
      assert.equal(res.status, 400, `amount ${JSON.stringify(amount)}`);
    }
    // JSON cannot carry Infinity/NaN; a huge exponent overflows to Infinity
    const inf = await (await c.agent()).post('/api/transactions').set('X-CSRF-Token', await c.token())
      .set('Content-Type', 'application/json').send('{"type":"expense","merchant":"x","category":"Food","amount":1e999,"date":"2026-01-01"}');
    assert.equal(inf.status, 400);
  });

  test('rejects invalid dates, types, text and categories', async () => {
    const cases = [
      { date: '2026-02-30' }, { date: '2026-13-01' }, { date: 'tomorrow' }, { date: '2026-1-5' }, { date: '1900-01-01' }, { date: 20260101 },
      { type: 'transfer' }, { type: '' },
      { merchant: '' }, { merchant: '   ' }, { merchant: 'x'.repeat(101) }, { merchant: { $ne: 1 } },
      { category: 'NoSuchCategory' }, { category: '' },
      { notes: 'n'.repeat(501) }, { recurring: 'maybe' },
    ];
    for (const patch of cases) {
      const res = await c.post('/api/transactions', { ...valid, ...patch });
      assert.equal(res.status, 400, JSON.stringify(patch));
      assert.equal(typeof res.body.error, 'string');
    }
  });

  test('rejects malformed ids and bodies', async () => {
    for (const id of ['abc', '1.5', '-1', '0', '99999999999', '1;DROP TABLE users', '%27']) {
      assert.equal((await c.get(`/api/transactions/${id}`)).status, 400, id);
      assert.equal((await c.put(`/api/transactions/${id}`, valid)).status, 400, id);
      assert.equal((await c.del(`/api/transactions/${id}`)).status, 400, id);
    }
    assert.equal((await c.post('/api/transactions', [valid])).status, 400);
    const agent = await c.agent();
    const token = await c.token();
    const malformed = await agent.post('/api/transactions').set('X-CSRF-Token', token).set('Content-Type', 'application/json').send('{"type":');
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(JSON.stringify(malformed.body), /at .*\.js|SyntaxError|stack/i, 'no stack traces leak');
    const huge = await agent.post('/api/transactions').set('X-CSRF-Token', token).send({ ...valid, notes: 'x'.repeat(20000) });
    assert.equal(huge.status, 413);
    const badQuery = await c.get('/api/transactions?type=income&type=expense');
    assert.equal(badQuery.status, 400);
  });

  test('filtering and search (wildcards are literal)', async () => {
    await c.post('/api/transactions', { ...valid, merchant: '100% Juice Bar' });
    await c.post('/api/transactions', { ...valid, merchant: 'Other Place' });
    await c.post('/api/transactions', { ...valid, type: 'income', category: 'Salary', merchant: 'Employer', amount: 1000 });
    assert.equal((await c.body('/api/transactions?search=100%25')).length, 1);
    assert.equal((await c.body('/api/transactions?search=%25')).length, 1, '% must not act as a wildcard');
    assert.ok((await c.body('/api/transactions?type=income')).every(t => t.type === 'income'));
    assert.ok((await c.body('/api/transactions?type=expense')).every(t => t.type === 'expense'));
    assert.equal((await c.get('/api/transactions?type=bogus')).status, 400);
    assert.equal((await c.body('/api/transactions?limit=1')).length, 1);
    assert.equal((await c.get('/api/transactions?limit=0')).status, 400);
    assert.equal((await c.body('/api/transactions?month=2026-03')).length, 3);
    assert.equal((await c.body('/api/transactions?month=2026-04')).length, 0);
  });

  test('XSS payloads are stored as inert text and never alter structure', async () => {
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const res = await c.post('/api/transactions', { ...valid, merchant: payload, notes: '"><svg onload=alert(3)>' });
    assert.equal(res.status, 201);
    assert.equal(res.body.merchant, payload, 'API returns JSON text unchanged; the UI renders it with textContent');
    assert.match(res.headers['content-type'], /application\/json/);

    // Style/markup injection through category fields is rejected outright
    assert.equal((await c.post('/api/categories', { type: 'expense', name: 'Evil', color: 'red;background:url(//x)' })).status, 400);
    assert.equal((await c.post('/api/categories', { type: 'expense', name: 'Evil', emoji: '<script>' })).status, 400);
    assert.equal((await c.post('/api/categories', { type: 'expense', name: 'Evil2', color: '#ff0000' })).body.color, '#FF0000');
  });
});

describe('cross-user data isolation', () => {
  let app, alice, bob, aliceTxn, aliceBudget, aliceCat;
  before(async () => {
    await resetDatabase(); app = makeApp();
    alice = new Client(app); bob = new Client(app);
    await alice.register(); await bob.register();
    aliceTxn = (await alice.post('/api/transactions', { ...valid, amount: 500, date: '2026-05-02' })).body;
    aliceBudget = (await alice.post('/api/budgets', { category: 'Food', limit_amount: 300 })).body;
    aliceCat = (await alice.post('/api/categories', { type: 'expense', name: 'Secret', color: '#123456' })).body;
    await alice.post('/api/budgets/monthly', { month: '2026-05', amount: 999 });
  });
  after(() => closeApp(app));

  test("bob cannot read, update or delete alice's transaction", async () => {
    assert.equal((await bob.get(`/api/transactions/${aliceTxn.id}`)).status, 404);
    assert.equal((await bob.put(`/api/transactions/${aliceTxn.id}`, { amount: 1 })).status, 404);
    assert.equal((await bob.del(`/api/transactions/${aliceTxn.id}`)).status, 404);
    assert.equal((await bob.body('/api/transactions')).length, 0);
    const still = await alice.body(`/api/transactions/${aliceTxn.id}`);
    assert.equal(still.amount, 500);
  });

  test("bob cannot see or delete alice's budgets and categories", async () => {
    assert.equal((await bob.del(`/api/budgets/${aliceBudget.id}`)).status, 404);
    assert.equal((await bob.del(`/api/categories/${aliceCat.id}`)).status, 404);
    assert.equal((await bob.body('/api/budgets')).length, 0);
    assert.ok(!(await bob.body('/api/categories')).some(x => x.name === 'Secret'));
    assert.equal((await bob.body('/api/budgets/monthly?month=2026-05')).budget, null);
    assert.equal((await alice.body('/api/budgets')).length, 1);
  });

  test("analytics only include the caller's data", async () => {
    const s = await bob.body('/api/analytics/summary?month=2026-05');
    assert.equal(s.totalExpenses, 0);
    assert.equal((await bob.body('/api/analytics/categories?month=2026-05')).length, 0);
    assert.equal((await bob.body('/api/analytics/heatmap?month=2026-05')).length, 0);
    assert.equal((await alice.body('/api/analytics/summary?month=2026-05')).monthlyExpenses, 500);
  });

  test('bob cannot create a transaction in a category only alice has', async () => {
    const res = await bob.post('/api/transactions', { ...valid, category: 'Secret' });
    assert.equal(res.status, 400);
  });
});
