'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { resetDatabase, makeApp, closeApp, Client, fakeMailer, serverFor } = require('./helpers');

describe('registration, login, logout', () => {
  let app;
  before(async () => { await resetDatabase(); app = makeApp(); });
  after(() => closeApp(app));

  test('register creates an account, signs in, and never returns the password hash', async () => {
    const c = new Client(app);
    const res = await c.post('/api/auth/register', { name: 'Ada', email: 'Ada@Example.test', password: 'long-enough-pw', currency: 'EUR' });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'ada@example.test');
    assert.equal(res.body.user.password_hash, undefined);
    const me = await c.body('/api/auth/me');
    assert.equal(me.name, 'Ada');
    assert.equal(me.currency, 'EUR');
    assert.equal(me.password_hash, undefined);
  });

  test('new accounts get default categories', async () => {
    const c = new Client(app);
    await c.register();
    const cats = await c.body('/api/categories');
    assert.ok(cats.some(x => x.name === 'Food' && x.type === 'expense'));
    assert.ok(cats.some(x => x.name === 'Salary' && x.type === 'income'));
  });

  test('duplicate email (case-insensitive) is rejected', async () => {
    const c = new Client(app);
    const u = await c.register();
    const res = await new Client(app).post('/api/auth/register', { name: 'X', email: u.email.toUpperCase(), password: 'another-password' });
    assert.equal(res.status, 409);
  });

  test('registration validates input on the server', async () => {
    const c = new Client(app);
    const bad = [
      { name: 'A', email: 'not-an-email', password: 'long-enough-pw' },
      { name: 'A', email: 'a@b.test', password: 'short' },
      { name: '', email: 'a@b.test', password: 'long-enough-pw' },
      { name: 'A', email: 'a@b.test', password: 'long-enough-pw', currency: 'XYZ' },
      { name: 'A'.repeat(101), email: 'a@b.test', password: 'long-enough-pw' },
      { name: 'A', email: 'a@b.test', password: 'x'.repeat(73) },
      { name: ['A'], email: 'a@b.test', password: 'long-enough-pw' },
    ];
    for (const body of bad) {
      const res = await c.post('/api/auth/register', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(res.body.error);
    }
  });

  test('login: wrong password and unknown email get the same generic 401', async () => {
    const u = await new Client(app).register();
    const c = new Client(app);
    const wrong = await c.post('/api/auth/login', { email: u.email, password: 'wrong-password' });
    const unknown = await c.post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong-password' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error);
  });

  test('login rotates the session id (no session fixation) and logout ends the session', async () => {
    const u = await new Client(app).register();
    const c = new Client(app);
    const pre = await c.get('/api/auth/csrf');
    const preCookie = pre.headers['set-cookie'][0].split(';')[0];
    c.csrf = pre.body.csrfToken;
    const login = await c.post('/api/auth/login', { email: u.email, password: u.password });
    assert.equal(login.status, 200);
    const postCookie = login.headers['set-cookie'][0].split(';')[0];
    assert.notEqual(preCookie, postCookie);

    await c.body('/api/auth/me');
    await c.post('/api/auth/logout').then(r => assert.equal(r.status, 200));
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  test('preferences are validated', async () => {
    const c = new Client(app);
    await c.register();
    assert.equal((await c.patch('/api/auth/preferences', { theme: 'light' })).status, 200);
    assert.equal((await c.patch('/api/auth/preferences', { currency: 'JPY' })).status, 200);
    assert.equal((await c.patch('/api/auth/preferences', { theme: 'neon' })).status, 400);
    assert.equal((await c.patch('/api/auth/preferences', { currency: '<script>' })).status, 400);
    assert.equal((await c.patch('/api/auth/preferences', {})).status, 400);
    const me = (await c.get('/api/auth/me')).body;
    assert.equal(me.theme, 'light');
    assert.equal(me.currency, 'JPY');
  });

  test('every listed world currency is accepted; unknown codes are rejected', async () => {
    const { CURRENCY_CODES } = require('../public/currencies');
    assert.ok(CURRENCY_CODES.length > 150);
    const c = new Client(app);
    await c.register({ currency: 'NGN' });
    assert.equal((await c.get('/api/auth/me')).body.currency, 'NGN');
    for (const code of ['KWD', 'BRL', 'XOF', 'CHF']) {
      assert.equal((await c.patch('/api/auth/preferences', { currency: code })).status, 200, code);
    }
    for (const bad of ['XYZ', 'usd', 'US', 'XDR']) {
      assert.equal((await c.patch('/api/auth/preferences', { currency: bad })).status, 400, bad);
    }
    for (const code of CURRENCY_CODES) {
      assert.doesNotThrow(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: code }), code);
    }
  });
});

describe('unauthorized access and expired sessions', () => {
  let app;
  before(async () => { await resetDatabase(); app = makeApp(); });
  after(() => closeApp(app));

  test('every data endpoint requires a session', async () => {
    const c = new Client(app);
    const gets = ['/api/auth/me', '/api/transactions', '/api/categories', '/api/budgets', '/api/budgets/monthly?month=2026-01',
                  '/api/analytics/summary', '/api/analytics/trends', '/api/analytics/categories', '/api/analytics/heatmap'];
    for (const url of gets) assert.equal((await c.get(url)).status, 401, url);
    assert.equal((await c.post('/api/transactions', {})).status, 401);
    assert.equal((await c.put('/api/transactions/1', {})).status, 401);
    assert.equal((await c.del('/api/transactions/1')).status, 401);
    assert.equal((await c.post('/api/categories', {})).status, 401);
    assert.equal((await c.del('/api/budgets/1')).status, 401);
    assert.equal((await c.patch('/api/auth/preferences', { theme: 'dark' })).status, 401);
  });

  test('a session removed from the store (expired/revoked) is rejected', async () => {
    const c = new Client(app);
    await c.register();
    await c.body('/api/auth/me');
    await app.locals.pool.query('UPDATE session SET expire = now() - interval \'1 minute\'');
    const res = await c.get('/api/transactions');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTHENTICATED');
  });

  test('unauthenticated page request gets the login page, not the dashboard', async () => {
    const res = await request(await serverFor(app)).get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /Sign In/);
  });
});

describe('CSRF protection', () => {
  let app;
  before(async () => { await resetDatabase(); app = makeApp(); });
  after(() => closeApp(app));

  test('state-changing requests without a valid token are rejected', async () => {
    const c = new Client(app);
    const u = await c.register();
    const agent = await c.agent();
    const noToken = await agent.post('/api/transactions').send({ type: 'expense' });
    assert.equal(noToken.status, 403);
    assert.equal(noToken.body.code, 'CSRF_INVALID');
    const wrong = await agent.delete('/api/transactions/1').set('X-CSRF-Token', 'x'.repeat(43));
    assert.equal(wrong.status, 403);
    const login = await request(await serverFor(app)).post('/api/auth/login').send({ email: u.email, password: u.password });
    assert.equal(login.status, 403, 'login also requires a token (login CSRF)');
  });
});

describe('password recovery', () => {
  test('is disabled safely when email is not configured', async () => {
    await resetDatabase();
    const app = makeApp(); // no SMTP → real mailer disabled
    try {
      const c = new Client(app);
      const u = await new Client(app).register();
      const cfg = (await c.get('/api/auth/config')).body;
      assert.equal(cfg.passwordResetEnabled, false);
      const forgot = await c.post('/api/auth/forgot-password', { email: u.email });
      assert.equal(forgot.status, 503);
      const reset = await c.post('/api/auth/reset-password', { token: 'a'.repeat(43), newPassword: 'new-password-1' });
      assert.equal(reset.status, 503);
    } finally { await closeApp(app); }
  });

  test('the old unauthenticated reset flow is gone', async () => {
    await resetDatabase();
    const app = makeApp({ mailer: fakeMailer() });
    try {
      const u = await new Client(app).register();
      const c = new Client(app);
      assert.equal((await c.post('/api/auth/find-account', { email: u.email })).status, 404);
      const legacy = await c.post('/api/auth/reset-password', { email: u.email, newPassword: 'hacked-password' });
      assert.equal(legacy.status, 400);
      assert.equal((await c.post('/api/auth/login', { email: u.email, password: 'hacked-password' })).status, 401);
      assert.equal((await new Client(app).post('/api/auth/login', { email: u.email, password: u.password })).status, 200);
    } finally { await closeApp(app); }
  });

  test('emailed single-use token resets the password and revokes sessions', async () => {
    await resetDatabase();
    const mailer = fakeMailer();
    const app = makeApp({ mailer, env: { APP_BASE_URL: 'https://finlytics.example' } });
    try {
      const owner = new Client(app);
      const u = await owner.register();
      await owner.body('/api/auth/me');

      const anon = new Client(app);
      const unknown = await anon.post('/api/auth/forgot-password', { email: 'nobody@example.test' });
      assert.equal(unknown.status, 202);
      assert.equal(mailer.sent.length, 0);

      const known = await anon.post('/api/auth/forgot-password', { email: u.email });
      assert.equal(known.status, 202);
      assert.equal(known.body.message, unknown.body.message, 'response must not reveal whether the account exists');
      assert.equal(mailer.sent.length, 1);
      const link = new URL(mailer.sent[0].link);
      assert.equal(link.origin, 'https://finlytics.example', 'link uses APP_BASE_URL, not the Host header');
      const token = link.searchParams.get('reset');
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);

      const { rows } = await app.locals.pool.query('SELECT token_hash FROM password_reset_tokens');
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].token_hash, token, 'raw token must not be stored');

      const weak = await anon.post('/api/auth/reset-password', { token, newPassword: 'short' });
      assert.equal(weak.status, 400);

      const ok = await anon.post('/api/auth/reset-password', { token, newPassword: 'brand-new-password' });
      assert.equal(ok.status, 200);
      assert.equal((await owner.get('/api/auth/me')).status, 401, 'existing sessions are revoked');

      const reuse = await anon.post('/api/auth/reset-password', { token, newPassword: 'another-new-password' });
      assert.equal(reuse.status, 400, 'token is single-use');

      assert.equal((await new Client(app).post('/api/auth/login', { email: u.email, password: u.password })).status, 401);
      assert.equal((await new Client(app).post('/api/auth/login', { email: u.email, password: 'brand-new-password' })).status, 200);
    } finally { await closeApp(app); }
  });

  test('expired and superseded tokens are rejected', async () => {
    await resetDatabase();
    const mailer = fakeMailer();
    const app = makeApp({ mailer, env: { APP_BASE_URL: 'https://finlytics.example' } });
    try {
      const u = await new Client(app).register();
      const c = new Client(app);
      await c.post('/api/auth/forgot-password', { email: u.email });
      const first = new URL(mailer.sent[0].link).searchParams.get('reset');
      await c.post('/api/auth/forgot-password', { email: u.email });
      const second = new URL(mailer.sent[1].link).searchParams.get('reset');
      assert.equal((await c.post('/api/auth/reset-password', { token: first, newPassword: 'brand-new-password' })).status, 400);

      await app.locals.pool.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second'");
      assert.equal((await c.post('/api/auth/reset-password', { token: second, newPassword: 'brand-new-password' })).status, 400);
      assert.equal((await c.post('/api/auth/reset-password', { token: '../../etc', newPassword: 'brand-new-password' })).status, 400);
    } finally { await closeApp(app); }
  });
});

describe('rate limiting', () => {
  test('failed logins, registrations and reset requests are throttled', async () => {
    await resetDatabase();
    const app = makeApp({
      mailer: fakeMailer(),
      env: { DISABLE_RATE_LIMITS: 'false', RATE_LIMIT_LOGIN: '3', RATE_LIMIT_REGISTER: '2', RATE_LIMIT_PASSWORD_RESET: '2', APP_BASE_URL: 'https://x.example' },
    });
    try {
      const c = new Client(app);
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await c.post('/api/auth/login', { email: 'a@b.test', password: 'wrong-password' })).status);
      assert.deepEqual(statuses, [401, 401, 401, 429]);

      const reg = [];
      for (let i = 0; i < 3; i++) reg.push((await c.post('/api/auth/register', { name: 'x', email: `r${i}@b.test`, password: 'long-enough-pw' })).status);
      assert.deepEqual(reg, [201, 201, 429]);

      const fp = [];
      for (let i = 0; i < 3; i++) fp.push((await c.post('/api/auth/forgot-password', { email: 'a@b.test' })).status);
      assert.deepEqual(fp, [202, 202, 429]);
    } finally { await closeApp(app); }
  });
});
