'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, makeApp, closeApp, Client } = require('./helpers');

describe('persistence across restarts and multiple instances', () => {
  before(resetDatabase);

  test('a session and data created on instance A are visible on instance B and after restart', async () => {
    const a = makeApp();
    const b = makeApp();
    try {
      const onA = new Client(a);
      await onA.register({ email: 'shared@example.test' });
      const t = (await onA.post('/api/transactions', { type: 'expense', merchant: 'Shared', category: 'Food', amount: 42, date: '2026-02-02' })).body;

      // Move the same cookie jar to instance B (like a load balancer would)
      const onB = new Client(b);
      onB._agent = await onB.agent();
      onB._agent.jar = (await onA.agent()).jar;
      onB.csrf = onA.csrf;
      const list = await onB.body('/api/transactions');
      assert.equal(list.length, 1);
      assert.equal(list[0].id, t.id);
      assert.equal((await onB.put(`/api/transactions/${t.id}`, { amount: 43 })).status, 200);
      assert.equal((await onA.body(`/api/transactions/${t.id}`)).amount, 43);
    } finally {
      await closeApp(a);
      await closeApp(b);
    }

    // "Restart": a brand-new app instance and pool
    const c = makeApp();
    try {
      const client = new Client(c);
      assert.equal((await client.post('/api/auth/login', { email: 'shared@example.test', password: 'correct-horse-9' })).status, 200);
      const list = await client.body('/api/transactions');
      assert.equal(list.length, 1);
      assert.equal(list[0].amount, 43);
    } finally {
      await closeApp(c);
    }
  });

  test('concurrent writes from two instances do not collide or lose data', async () => {
    const a = makeApp();
    const b = makeApp();
    try {
      const ca = new Client(a); await ca.register();
      const cb = new Client(b); await cb.register();
      const make = (client, i) => client.post('/api/transactions', { type: 'expense', merchant: `m${i}`, category: 'Food', amount: 1, date: '2026-02-03' });
      // Prime tokens so requests can run in parallel
      await ca.token(); await cb.token();
      const results = await Promise.all([...Array(25)].flatMap((_, i) => [make(ca, i), make(cb, i)]));
      assert.ok(results.every(r => r.status === 201));
      const ids = new Set(results.map(r => r.body.id));
      assert.equal(ids.size, 50, 'every row got a unique id');
      assert.equal((await ca.body('/api/transactions')).length, 25);
      assert.equal((await cb.body('/api/transactions')).length, 25);

      // Concurrent budget upserts for the same category end with exactly one row
      await Promise.all([...Array(10)].map((_, i) => ca.post('/api/budgets', { category: 'Food', limit_amount: 100 + i })));
      assert.equal((await ca.body('/api/budgets')).length, 1);

      // Concurrent duplicate registrations: exactly one wins
      const regs = await Promise.all([...Array(5)].map(() => new Client(a).post('/api/auth/register', { name: 'Dup', email: 'dup@example.test', password: 'long-enough-pw' })));
      assert.equal(regs.filter(r => r.status === 201).length, 1);
      assert.equal(regs.filter(r => r.status === 409).length, 4);
    } finally {
      await closeApp(a);
      await closeApp(b);
    }
  });
});
