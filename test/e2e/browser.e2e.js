#!/usr/bin/env node
// ============================================================
// Browser end-to-end check (Playwright + Chromium)
// ============================================================
// Runs the real app against the isolated test database with fictional demo
// data and drives it in headless Chromium (desktop + mobile viewports).
//   npm run test:e2e           (needs TEST_DATABASE_URL and a Chromium build)
// Optional: CHROMIUM_PATH=/path/to/chrome, E2E_SCREENSHOTS=/some/dir
'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright-core');
const { resetDatabase, makeApp, closeApp, serverFor, testConfig } = require('../helpers');
const { createPool } = require('../../db/pool');
const { seedDemo } = require('../../scripts/seed-demo');

const shotsDir = process.env.E2E_SCREENSHOTS;
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✘ ${name}\n    ${err.message.split('\n').join('\n    ')}\n    ${(err.stack || '').split('\n').find(l => l.includes('browser.e2e.js')) || ''}`);
  }
}

function localMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  await resetDatabase();
  const seedPool = createPool(testConfig());
  await seedDemo(seedPool, { password: 'demo1234', month: localMonth() });

  const app = makeApp({ env: { DEMO_MODE: 'true' } });
  const server = await serverFor(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  const consoleProblems = [];
  const expectedFailures = new Set(); // URLs we deliberately break
  function watch(page, label) {
    page.on('pageerror', err => consoleProblems.push(`[${label}] pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() !== 'error' && msg.type() !== 'warning') return;
      const text = msg.text();
      if (/Failed to load resource/.test(text) && [...expectedFailures].some(u => (msg.location().url || '').includes(u))) return;
      if (/Failed to load resource: the server responded with a status of 401/.test(text)) return; // expected on session-expiry step
      consoleProblems.push(`[${label}] console.${msg.type()}: ${text} ${msg.location().url || ''}`);
    });
  }
  const shot = async (page, name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true }); };

  try {
    // ── Desktop ─────────────────────────────────────────────
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    page.on('dialog', d => d.accept());

    await step('unauthenticated visit shows the login page; recovery disabled without SMTP', async () => {
      await page.goto(base + '/');
      await page.waitForSelector('#login-form');
      await page.click('#tab-forgot');
      assert.match(await page.textContent('#forgot-info-text'), /not configured/);
      assert.equal(await page.isDisabled('#forgot-btn'), true);
      await page.click('#tab-login');
      await shot(page, '01-login');
    });

    await step('wrong password shows an error, demo login works', async () => {
      await page.fill('#login-email', 'demo@finlytics.app');
      await page.fill('#login-password', 'not-the-password');
      await page.click('#login-btn');
      await page.waitForSelector('#auth-error.visible');
      assert.match(await page.textContent('#auth-error'), /Invalid email or password/);
      await page.click('#demo-btn');
      await page.click('#login-btn');
      await page.waitForURL(base + '/');
      await page.waitForFunction(() => (document.getElementById('val-income') || {}).textContent?.includes('6,200'));
    });

    await step('dashboard totals match the API and render without errors', async () => {
      const summary = await page.evaluate(async m => (await fetch(`/api/analytics/summary?month=${m}`)).json(), localMonth());
      const fmt = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
      assert.equal(await page.textContent('#val-balance'), fmt(summary.balance));
      assert.equal(await page.textContent('#val-income'), fmt(summary.monthlyIncome));
      assert.equal(await page.textContent('#val-expenses'), fmt(summary.monthlyExpenses));
      assert.equal(await page.textContent('#val-savings'), `${summary.savingsRate}%`);
      assert.match(await page.textContent('#dash-greeting'), /Hi, Alex/);
      assert.equal(await page.locator('#recent-txn-list .txn-row').count(), 5);
      assert.ok(await page.isVisible('#bov-card'));
      assert.equal(await page.textContent('#bov-limit'), '$5,000.00');
      await page.waitForTimeout(500);
      await shot(page, '02-dashboard');
    });

    const xss = '<img src=x onerror="window.__xss=1">Evil';
    await step('create a transaction with an XSS payload: stored and shown as plain text', async () => {
      await page.click('.fab');
      await page.waitForSelector('#txn-modal-overlay.open');
      await page.fill('#txn-amount', '25.50');
      await page.click('#txn-cat-grid .cat-btn[data-cat="Food"]');
      await page.fill('#txn-merchant', xss);
      await page.click('#txn-save-btn');
      await page.waitForSelector('#toast.show:not(.error)');
      assert.match(await page.textContent('#toast'), /Transaction saved/);
      const row = page.locator('#recent-txn-list .txn-merchant', { hasText: 'Evil' });
      await row.first().waitFor();
      assert.equal(await row.first().textContent(), xss);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      assert.equal(await page.locator('#recent-txn-list img').count(), 0);
    });

    await step('edit the transaction', async () => {
      const row = page.locator('#recent-txn-list .txn-row', { hasText: 'Evil' }).first();
      await row.hover();
      await row.locator('.txn-action-btn.edit').click();
      await page.waitForSelector('#txn-modal-overlay.open');
      assert.equal(await page.textContent('#txn-modal-title'), 'Edit Transaction');
      assert.equal(await page.inputValue('#txn-amount'), '25.5');
      await page.fill('#txn-amount', '30');
      await page.click('#txn-save-btn');
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Transaction updated'));
      await page.locator('#recent-txn-list .txn-row', { hasText: 'Evil' }).locator('.txn-amount', { hasText: '-$30.00' }).waitFor();
    });

    await step('duplicate submissions are blocked while a request is pending', async () => {
      let posts = 0;
      await page.route('**/api/transactions', async route => {
        if (route.request().method() === 'POST') { posts++; await new Promise(r => setTimeout(r, 600)); }
        await route.continue();
      });
      await page.click('.fab');
      await page.waitForSelector('#txn-modal-overlay.open');
      await page.fill('#txn-amount', '1.00');
      await page.click('#txn-cat-grid .cat-btn[data-cat="Food"]');
      await page.fill('#txn-merchant', 'Double click test');
      await page.click('#txn-save-btn');
      await page.click('#txn-save-btn', { force: true }).catch(() => {});
      await page.dispatchEvent('#txn-form', 'submit').catch(() => {});
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Transaction saved'));
      await page.unroute('**/api/transactions');
      assert.equal(posts, 1);
    });

    await step('failed save shows an error and never a success toast', async () => {
      expectedFailures.add('/api/transactions');
      await page.route('**/api/transactions', route => route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Something went wrong. Please try again."}' })
        : route.continue());
      await page.click('.fab');
      await page.waitForSelector('#txn-modal-overlay.open');
      await page.fill('#txn-amount', '5');
      await page.click('#txn-cat-grid .cat-btn[data-cat="Food"]');
      await page.fill('#txn-merchant', 'Will fail');
      await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
      await page.click('#txn-save-btn');
      await page.waitForSelector('#toast.show.error');
      assert.match(await page.textContent('#toast'), /Something went wrong/);
      assert.ok(await page.isVisible('#txn-modal-overlay.open'), 'modal stays open so input is not lost');
      await page.unroute('**/api/transactions');
      await page.keyboard.press('Escape');
    });

    await step('network failure and malformed responses show an error state instead of crashing', async () => {
      await page.route('**/api/transactions?*', route => route.abort('internetdisconnected'));
      await page.click('.nav-item[data-page="transactions"]');
      await page.waitForSelector('#all-txn-list .empty-title');
      assert.equal(await page.textContent('#all-txn-list .empty-title'), 'Could not load data');
      await page.unroute('**/api/transactions?*');
      await page.route('**/api/transactions?*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>proxy error</html>' }));
      await page.click('#all-txn-list button');
      await page.waitForSelector('#toast.show.error, #all-txn-list .empty-title');
      await page.unroute('**/api/transactions?*');
      await page.click('#all-txn-list button');
      await page.waitForSelector('#all-txn-list .txn-row');
    });

    await step('search, filter and delete on the transactions page', async () => {
      await page.fill('#txn-search', 'onerror');
      await page.waitForFunction(() => document.querySelectorAll('#all-txn-list .txn-row').length === 1);
      await page.fill('#txn-search', '');
      await page.click('.chip[data-filter-type="income"]');
      await page.waitForFunction(() => [...document.querySelectorAll('#all-txn-list .txn-amount')].every(e => e.classList.contains('income')));
      await page.click('.chip[data-filter-type="all"]');
      await page.fill('#txn-search', 'Double click test');
      await page.waitForFunction(() => document.querySelectorAll('#all-txn-list .txn-row').length === 1);
      const row = page.locator('#all-txn-list .txn-row').first();
      await row.hover();
      await row.locator('.txn-action-btn.delete').click();
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Transaction deleted'));
      await page.waitForSelector('#all-txn-list .empty-title');
      await page.fill('#txn-search', '');
      await shot(page, '03-transactions');
    });

    await step('custom category with markup in its name renders as text; can be deleted', async () => {
      await page.click('.nav-item[data-page="settings"]');
      await page.click('[data-action="open-create-category"]');
      await page.fill('#cc-name', '<b>Bold</b>');
      await page.click('.color-swatch[data-color="#EC4899"]');
      await page.click('#cc-save-btn');
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Category created'));
      const item = page.locator('.category-manage-item', { hasText: '<b>Bold</b>' });
      await item.waitFor();
      assert.equal(await page.locator('.category-manage-list b').count(), 0);
      assert.equal(await page.textContent('#st-total-txns'), String(await page.evaluate(async () => (await (await fetch('/api/transactions')).json()).length)));
      await item.locator('button').click();
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Category deleted'));
      await shot(page, '04-settings');
    });

    await step('budgets page: utilization, add and remove a category budget, monthly target', async () => {
      await page.click('.nav-item[data-page="budgets"]');
      await page.waitForSelector('#budget-list .budget-card');
      assert.equal(await page.locator('#budget-list .budget-card').count(), 8);
      const food = page.locator('.budget-card', { hasText: 'Food' });
      assert.match(await food.locator('.budget-limit').textContent(), /\$600\.00/);
      await page.click('[data-action="open-budget-modal"]');
      await page.selectOption('#budget-category', 'Food');
      await page.fill('#budget-limit', '650');
      await page.click('#budget-save-btn');
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Budget saved'));
      await page.locator('.budget-card', { hasText: 'Food' }).locator('.budget-limit', { hasText: '$650.00' }).waitFor();
      assert.equal(await page.locator('#budget-list .budget-card').count(), 8, 'upsert, not a duplicate');
      await page.locator('.budget-card', { hasText: 'Education' }).locator('button').click();
      await page.waitForFunction(() => document.querySelectorAll('#budget-list .budget-card').length === 7);
      await page.click('.budget-summary-card .link-btn');
      await page.waitForSelector('#monthly-budget-modal-overlay.open');
      assert.equal(await page.inputValue('#mb-amount'), '5000', 'prefilled with the saved target');
      await page.fill('#mb-amount', '4000');
      await page.click('#mb-save-btn');
      await page.waitForFunction(() => document.querySelector('.budget-summary-card .bsc-value').textContent === '$4,000.00');
      await shot(page, '05-budgets');
    });

    await step('currency and dark mode preferences persist across reloads', async () => {
      await page.click('.nav-item[data-page="settings"]');
      await page.selectOption('#setting-currency', 'EUR');
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Preferences updated'));
      const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await page.click('#sidebar-theme-toggle');
      await page.waitForFunction(b => document.documentElement.getAttribute('data-theme') !== b, before);
      await page.waitForTimeout(300);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('val-income').textContent.includes('€'));
      assert.notEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), before);
      await shot(page, '06-dashboard-eur-theme');
    });

    await step('expired session redirects to sign-in with a message', async () => {
      await app.locals.pool.query('DELETE FROM session');
      await page.click('.nav-item[data-page="transactions"]');
      await page.waitForURL(/\/login\.html/);
      await page.waitForSelector('#auth-error.visible');
      assert.match(await page.textContent('#auth-error'), /session has expired/);
      assert.doesNotMatch(page.url(), /expired/, 'query string is cleaned up');
    });
    await ctx.close();

    // ── Mobile ──────────────────────────────────────────────
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    m.on('dialog', d => d.accept());

    await step('mobile: login, bottom navigation works, no horizontal overflow', async () => {
      await m.goto(base + '/login.html');
      await m.fill('#login-email', 'demo@finlytics.app');
      await m.fill('#login-password', 'demo1234');
      await m.click('#login-btn');
      await m.waitForURL(base + '/');
      await m.waitForFunction(() => { const e = document.getElementById('val-income'); return e && e.textContent !== '--'; });
      assert.ok(await m.isVisible('.nav-item[data-page="budgets"]'), 'navigation is reachable on mobile');
      await m.tap('.nav-item[data-page="budgets"]');
      await m.waitForSelector('#page-budgets.active #budget-list .budget-card');
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `page overflows horizontally by ${overflow}px`);
      await m.tap('.nav-item[data-page="dashboard"]');
      await m.waitForTimeout(400);
      await shot(m, '07-mobile-dashboard');
      await m.tap('.fab');
      await m.waitForSelector('#txn-modal-overlay.open');
      await shot(m, '08-mobile-add-txn');
      await m.keyboard.press('Escape');
    });

    await step('mobile: sign out', async () => {
      await m.tap('.nav-item[data-page="settings"]');
      await m.tap('#page-settings [data-action="logout"]');
      await m.waitForURL(/login\.html/);
      const me = await m.evaluate(async () => (await fetch('/api/auth/me')).status);
      assert.equal(me, 401);
    });
    await mctx.close();

    await step('no unexpected console errors, page errors or CSP violations', async () => {
      assert.deepEqual(consoleProblems, []);
    });
  } finally {
    await browser.close();
    await seedPool.end();
    await closeApp(app);
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} browser checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
