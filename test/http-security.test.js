'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { resetDatabase, makeApp, closeApp, Client, serverFor } = require('./helpers');

describe('HTTP security configuration', () => {
  before(resetDatabase);

  test('security headers and CSP are present', async () => {
    const app = makeApp();
    try {
      const res = await request(await serverFor(app)).get('/login.html');
      assert.equal(res.status, 200);
      const csp = res.headers['content-security-policy'];
      assert.match(csp, /script-src 'self'(;|$)/);
      assert.match(csp, /script-src-attr 'none'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
      assert.equal(res.headers['x-powered-by'], undefined);
    } finally { await closeApp(app); }
  });

  test('production cookies are Secure, HttpOnly, SameSite=Lax with __Host- prefix behind a trusted proxy', async () => {
    const app = makeApp({ env: { NODE_ENV: 'production', DATABASE_SSL: 'disable', TRUST_PROXY: '1', SESSION_SECRET: 'f00d'.repeat(16) } });
    try {
      const res = await request(await serverFor(app)).get('/api/auth/csrf').set('X-Forwarded-Proto', 'https');
      const cookie = res.headers['set-cookie'][0];
      assert.match(cookie, /^__Host-finlytics\.sid=/);
      assert.match(cookie, /; Secure/);
      assert.match(cookie, /; HttpOnly/);
      assert.match(cookie, /; SameSite=Lax/);
      assert.match(res.headers['strict-transport-security'], /max-age=31536000/);
      const cfg = await request(await serverFor(app)).get('/api/auth/config');
      assert.equal(cfg.body.demoEnabled, false);
    } finally { await closeApp(app); }
  });

  test('CORS only allows configured origins', async () => {
    const app = makeApp({ env: { CORS_ORIGINS: 'https://trusted.example' } });
    try {
      const srv = await serverFor(app);
      const ok = await request(srv).get('/api/auth/config').set('Origin', 'https://trusted.example');
      assert.equal(ok.headers['access-control-allow-origin'], 'https://trusted.example');
      assert.equal(ok.headers['access-control-allow-credentials'], 'true');
      const bad = await request(srv).get('/api/auth/config').set('Origin', 'https://evil.example');
      assert.equal(bad.status, 403);
      assert.equal(bad.headers['access-control-allow-origin'], undefined);
    } finally { await closeApp(app); }

    const noCors = makeApp();
    try {
      const res = await request(await serverFor(noCors)).get('/api/auth/config').set('Origin', 'https://evil.example');
      assert.equal(res.headers['access-control-allow-origin'], undefined, 'no CORS headers unless configured');
    } finally { await closeApp(noCors); }
  });

  test('unknown API routes return JSON 404; errors never include stack traces', async () => {
    const app = makeApp();
    try {
      const c = new Client(app);
      const res = await c.get('/api/nope');
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: 'Not found' });
    } finally { await closeApp(app); }
  });

  test('frontend has no inline scripts/handlers and no HTML-string sinks', () => {
    const pub = path.join(__dirname, '..', 'public');
    for (const f of ['index.html', 'login.html']) {
      const html = fs.readFileSync(path.join(pub, f), 'utf8');
      assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${f}: inline event handler`);
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${f}: inline <script>`);
      assert.doesNotMatch(html, /cdn\.jsdelivr|unpkg|cdnjs/i, `${f}: third-party script`);
    }
    for (const f of ['app.js', 'login.js', 'common.js']) {
      const js = fs.readFileSync(path.join(pub, f), 'utf8');
      assert.doesNotMatch(js, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML|document\.write/, `${f}: HTML string sink`);
    }
  });
});
