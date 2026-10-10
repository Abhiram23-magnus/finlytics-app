// ============================================================
// Test helpers — isolated PostgreSQL test database
// ============================================================
'use strict';

const http    = require('http');
const request = require('supertest');
const { loadConfig } = require('../lib/config');
const { createPool } = require('../db/pool');
const { migrate }    = require('../db/migrate');
const { createApp }  = require('../lib/createApp');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://localhost:5432/finlytics_test';

// Guard: the test suite wipes the schema, so never point it at a real database.
if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error('TEST_DATABASE_URL must point to a database whose name contains "test".');
}

function testConfig(env = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    SESSION_SECRET: 'test-only-secret-0123456789abcdef0123456789abcdef',
    DISABLE_RATE_LIMITS: 'true',
    ...env,
  });
}

async function resetDatabase() {
  const pool = createPool(testConfig());
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}

/** A fake mailer that records messages instead of sending them. */
function fakeMailer() {
  const sent = [];
  return {
    enabled: true,
    sent,
    async sendPasswordReset(to, name, link) { sent.push({ to, name, link }); },
  };
}

function makeApp({ env, mailer } = {}) {
  const config = testConfig(env);
  return createApp({ config, mailer });
}

/** One listening server per app, shared by all clients (keeps cookies stable). */
async function serverFor(app) {
  if (!app.locals.server) {
    app.locals.server = http.createServer(app);
    app.locals.listening = new Promise(r => app.locals.server.listen(0, '127.0.0.1', r));
  }
  await app.locals.listening;
  return app.locals.server;
}

async function closeApp(app) {
  if (app.locals.server) await new Promise(r => app.locals.server.close(r));
  await app.locals.pool.end();
}

/** A cookie-keeping client that handles the CSRF token like the browser does. */
class Client {
  constructor(app) {
    this.app = app;
    this._agent = null;
    this.csrf = null;
  }
  /** supertest agent bound to an already-listening server. */
  async agent() {
    if (!this._agent) this._agent = request.agent(await serverFor(this.app));
    return this._agent;
  }
  async token() {
    if (!this.csrf) {
      const res = await (await this.agent()).get('/api/auth/csrf');
      this.csrf = res.body.csrfToken;
    }
    return this.csrf;
  }
  async get(url) { return (await this.agent()).get(url); }
  /** GET that must succeed with the given status; returns the parsed body. */
  async body(url, status = 200) {
    const res = await this.get(url);
    if (res.status !== status) throw new Error(`GET ${url} → ${res.status} (expected ${status}): ${JSON.stringify(res.body)}`);
    return res.body;
  }
  async send(method, url, body, retried = false) {
    const token = await this.token(); // must run before the request picks up cookies
    const res = await (await this.agent())[method](url).set('X-CSRF-Token', token).send(body);
    // Like the browser client: a rotated session invalidates the token → refresh once.
    if (res.status === 403 && res.body && res.body.code === 'CSRF_INVALID' && !retried) {
      this.csrf = null;
      return this.send(method, url, body, true);
    }
    if (res.body && res.body.csrfToken) this.csrf = res.body.csrfToken;
    return res;
  }
  post(url, body = {}) { return this.send('post', url, body); }
  put(url, body = {}) { return this.send('put', url, body); }
  patch(url, body = {}) { return this.send('patch', url, body); }
  del(url) { return this.send('delete', url); }

  async register(overrides = {}) {
    const n = Math.random().toString(36).slice(2, 10);
    const body = { name: 'Test User', email: `user-${n}@example.test`, password: 'correct-horse-9', currency: 'USD', ...overrides };
    const res = await this.post('/api/auth/register', body);
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { ...body, id: res.body.user.id };
  }
}

module.exports = { serverFor, TEST_DATABASE_URL, testConfig, resetDatabase, fakeMailer, makeApp, closeApp, Client };
