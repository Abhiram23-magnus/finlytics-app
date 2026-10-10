// ============================================================
// FINLYTICS — Shared browser helpers (API client, safe DOM, formatting)
// ============================================================
'use strict';

// ── API client ────────────────────────────────────────────────
// Every request goes through here so that CSRF tokens, timeouts, HTTP errors,
// network failures, expired sessions and malformed responses are handled the
// same way everywhere. Callers get parsed JSON or a thrown ApiError.
const Api = (() => {
  let csrfToken = null;

  class ApiError extends Error {
    constructor(message, status, code, field) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.field = field;
    }
  }

  async function fetchCsrf() {
    const res = await fetch('/api/auth/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.csrfToken !== 'string') {
      throw new ApiError('Could not reach the server. Please try again.', res.status, 'CSRF_FETCH_FAILED');
    }
    csrfToken = data.csrfToken;
    return csrfToken;
  }

  async function request(method, url, body, retried = false) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken || await fetchCsrf();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(url, {
        method, headers, credentials: 'same-origin', signal: controller.signal,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError(err && err.name === 'AbortError'
        ? 'The server took too long to respond. Please try again.'
        : 'Network error. Check your connection and try again.', 0, 'NETWORK');
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      data = await res.json().catch(() => null);
    }

    // Stale CSRF token (e.g. after the session rotated) — refresh once and retry.
    if (res.status === 403 && data && data.code === 'CSRF_INVALID' && !retried) {
      await fetchCsrf();
      return request(method, url, body, true);
    }
    if (!res.ok) {
      const message = data && typeof data.error === 'string' ? data.error : `Request failed (${res.status}). Please try again.`;
      const err = new ApiError(message, res.status, data && data.code, data && data.field);
      if (res.status === 401 && typeof Api.onUnauthorized === 'function') Api.onUnauthorized(err);
      throw err;
    }
    if (data === null || typeof data !== 'object') {
      throw new ApiError('Unexpected response from the server.', res.status, 'MALFORMED_RESPONSE');
    }
    return data;
  }

  return {
    ApiError,
    onUnauthorized: null,
    setCsrfToken(t) { if (typeof t === 'string') csrfToken = t; },
    get:   url         => request('GET', url),
    post:  (url, body) => request('POST', url, body === undefined ? {} : body),
    put:   (url, body) => request('PUT', url, body),
    patch: (url, body) => request('PATCH', url, body),
    del:   url         => request('DELETE', url),
  };
})();

// ── Safe DOM construction ─────────────────────────────────────
// h('div', { class: 'x', text: userValue }, child...) — text is always set via
// textContent, styles via CSSOM, never via HTML strings.
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/** Clones a static <template id="..."> icon. */
function icon(id) {
  const tpl = document.getElementById(id);
  return tpl ? tpl.content.firstElementChild.cloneNode(true) : document.createTextNode('');
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const FALLBACK_COLOR = '#64748B';

/** Only well-formed hex colors from the server ever reach a style property. */
function safeColor(c) { return typeof c === 'string' && HEX_COLOR.test(c) ? c : FALLBACK_COLOR; }

/** Translucent background derived from a validated hex color. */
function tint(c, alpha = 0.12) {
  const hex = safeColor(c);
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ── Formatting ────────────────────────────────────────────────
const currencyNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'currency' }); } catch { return null; }
})();

function currencySymbol(code) {
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).formatToParts(0);
    return (parts.find(p => p.type === 'currency') || {}).value || code;
  } catch { return code; }
}

/** Flag emoji from the code's country prefix (USD → 🇺🇸, EUR → 🇪🇺); a globe for supranational codes like XOF. */
function currencyFlag(code) {
  if (code[0] === 'X') return '🌐';
  return String.fromCodePoint(...[...code.slice(0, 2)].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

// Every currency in public/currencies.js, sorted by name.
const CURRENCIES = CURRENCY_CODES.map(code => ({
  code,
  symbol: currencySymbol(code),
  name: (currencyNames && currencyNames.of(code)) || code,
  flag: currencyFlag(code),
})).sort((a, b) => a.name.localeCompare(b.name));

const DEFAULT_CURRENCY = CURRENCIES.find(c => c.code === 'USD');
function currencyInfo(code) { return CURRENCIES.find(c => c.code === code) || DEFAULT_CURRENCY; }

const moneyFormatters = new Map();
/** Formats an amount in the given ISO currency (e.g. "$1,234.50", "¥1,235"). */
function formatMoney(amount, code) {
  const n = Number(amount);
  const value = Number.isFinite(n) ? n : 0;
  const cur = currencyInfo(code).code;
  if (!moneyFormatters.has(cur)) {
    moneyFormatters.set(cur, new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }));
  }
  return moneyFormatters.get(cur).format(value);
}

/** 'YYYY-MM-DD' → "Oct 5, 2026", interpreted as a calendar date (no timezone shift). */
function formatDate(dateStr) {
  const m = typeof dateStr === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Today's date in the user's local timezone as 'YYYY-MM-DD'. */
function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localMonthString(d = new Date()) { return localDateString(d).slice(0, 7); }

// ── UI helpers ────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, kind = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.replaceChildren(icon(kind === 'error' ? 'icon-alert' : 'icon-check'), document.createTextNode(String(message)));
  el.classList.toggle('error', kind === 'error');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 5000 : 3000);
}

/**
 * Disables a button while `task` runs, preventing duplicate submissions.
 * Returns the task's result; rethrows its error.
 */
async function withBusy(button, busyText, task) {
  if (button && button.disabled) return undefined;
  const original = button ? button.textContent : '';
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); if (busyText) button.textContent = busyText; }
  try {
    return await task();
  } finally {
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = original; }
  }
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/** Decorative floating currency symbols in the background. */
function generateSymbols() {
  const container = document.getElementById('bg-symbols');
  if (!container) return;
  const symbols = ['$', '€', '£', '¥', '₹', 'C$', 'A$'];
  for (let i = 0; i < 25; i++) {
    container.append(h('div', {
      class: 'bg-symbol',
      text: symbols[Math.floor(Math.random() * symbols.length)],
      style: {
        left: Math.random() * 100 + 'vw',
        fontSize: (Math.random() * 40 + 20) + 'px',
        animationDuration: (Math.random() * 10 + 10) + 's',
        animationDelay: (Math.random() * 10) + 's',
      },
    }));
  }
}

document.addEventListener('DOMContentLoaded', generateSymbols);
