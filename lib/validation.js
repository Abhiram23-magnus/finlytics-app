// ============================================================
// FINLYTICS — Server-side input validation
// ============================================================
// Every route validates its own input here. Validators either return a clean
// value or throw a ValidationError (→ HTTP 400 with a user-facing message).
'use strict';

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.field = field;
  }
}

const CURRENCIES  = require('../public/currencies').CURRENCY_CODES;
const THEMES      = ['light', 'dark'];
const TXN_TYPES   = ['income', 'expense'];
const MAX_AMOUNT  = 1_000_000_000;
const HEX_COLOR   = /^#[0-9A-Fa-f]{6}$/;
const EMAIL       = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
// Strip ASCII control chars (keeps tab/newline out of single-line fields too)
// eslint-disable-next-line no-control-regex
const CONTROL     = /[\u0000-\u001F\u007F]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_ML  = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function fail(field, message) { throw new ValidationError(message, field); }

function isPresent(v) { return v !== undefined && v !== null && v !== ''; }

/** Single-line text: trimmed, control chars removed, length-bounded. */
function text(value, field, { max, min = 1, required = true } = {}) {
  if (!isPresent(value)) {
    if (required) fail(field, `${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') fail(field, `${field} must be text.`);
  const clean = value.replace(CONTROL, '').trim();
  if (clean.length < min) fail(field, `${field} is required.`);
  if (clean.length > max) fail(field, `${field} must be at most ${max} characters.`);
  return clean;
}

function multiline(value, field, { max }) {
  if (!isPresent(value)) return '';
  if (typeof value !== 'string') fail(field, `${field} must be text.`);
  const clean = value.replace(CONTROL_ML, '').trim();
  if (clean.length > max) fail(field, `${field} must be at most ${max} characters.`);
  return clean;
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) fail(field, `${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

/** Positive finite money amount with at most 2 decimals. Accepts number or numeric string. */
function amount(value, field = 'amount') {
  if (!isPresent(value)) fail(field, `${field} is required.`);
  if (typeof value !== 'number' && typeof value !== 'string') fail(field, `${field} must be a number.`);
  if (typeof value === 'string' && !/^\s*\d+(\.\d+)?\s*$/.test(value)) fail(field, `${field} must be a positive number.`);
  const n = Number(value);
  if (!Number.isFinite(n)) fail(field, `${field} must be a finite number.`);
  if (n <= 0) fail(field, `${field} must be greater than zero.`);
  if (n > MAX_AMOUNT) fail(field, `${field} is too large.`);
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - n) > 1e-9) fail(field, `${field} can have at most 2 decimal places.`);
  return rounded;
}

/** Calendar date 'YYYY-MM-DD' that actually exists (rejects 2024-02-30). */
function date(value, field = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(field, `${field} must be a date in YYYY-MM-DD format.`);
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) fail(field, `${field} is not a valid date.`);
  if (y < 1970 || y > 2100) fail(field, `${field} must be between 1970 and 2100.`);
  return value;
}

/** Month key 'YYYY-MM'. */
function month(value, field = 'month') {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) fail(field, `${field} must be in YYYY-MM format.`);
  const y = Number(value.slice(0, 4));
  if (y < 1970 || y > 2100) fail(field, `${field} must be between 1970 and 2100.`);
  return value;
}

/** Route param id: positive 32-bit integer. */
function id(value, field = 'id') {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2_147_483_647) fail(field, 'Invalid id.');
  return Number(value);
}

function boolean(value, field) {
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(field, `${field} must be true or false.`);
}

function color(value, field = 'color', fallback) {
  if (!isPresent(value)) {
    if (fallback) return fallback;
    fail(field, `${field} is required.`);
  }
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) fail(field, `${field} must be a hex color like #10B981.`);
  return value.toUpperCase();
}

/** Short emoji/icon string. Rendered with textContent, but still bounded. */
function emoji(value, field = 'emoji', fallback = '🏷') {
  if (!isPresent(value)) return fallback;
  if (typeof value !== 'string') fail(field, `${field} must be text.`);
  const clean = value.replace(CONTROL, '').trim();
  if (!clean) return fallback;
  if ([...clean].length > 4 || clean.length > 16) fail(field, `${field} must be a single emoji.`);
  if (/[<>"'`&]/.test(clean)) fail(field, `${field} contains invalid characters.`);
  return clean;
}

function email(value, field = 'email') {
  const clean = text(value, field, { max: 254 }).toLowerCase();
  if (!EMAIL.test(clean)) fail(field, 'Please enter a valid email address.');
  return clean;
}

/** New password: 8–72 bytes (bcrypt only uses the first 72 bytes). */
function newPassword(value, field = 'password') {
  if (typeof value !== 'string' || value.length === 0) fail(field, 'Password is required.');
  if (value.length < 8) fail(field, 'Password must be at least 8 characters.');
  if (Buffer.byteLength(value, 'utf8') > 72) fail(field, 'Password must be at most 72 bytes.');
  return value;
}

/** Rejects request bodies that are not plain JSON objects. */
function body(req) {
  const b = req.body;
  if (b === undefined) return {};
  if (b === null || typeof b !== 'object' || Array.isArray(b)) fail('body', 'Request body must be a JSON object.');
  return b;
}

/** Reads a query-string parameter, rejecting arrays/objects (?a=1&a=2). */
function queryString(req, name) {
  const v = req.query[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') fail(name, `${name} must be a single value.`);
  return v;
}

module.exports = {
  ValidationError, CURRENCIES, THEMES, TXN_TYPES, MAX_AMOUNT,
  text, multiline, oneOf, amount, date, month, id, boolean, color, emoji, email, newPassword, body, queryString,
};
