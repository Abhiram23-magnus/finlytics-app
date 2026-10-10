# Finlytics security & quality audit (October 2026)

Scope: the whole repository at commit `7bbd531` (Express API, lowdb JSON storage,
static frontend, Vercel config, dependencies). Findings are listed in the order
they were prioritised, with the fix applied on this branch.

## Prioritised findings

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Critical | **Account takeover:** `POST /api/auth/reset-password` changed any account's password given only its email, then signed the caller in. `find-account` confirmed which emails exist and returned the owner's name. | Removed both endpoints. New flow: emailed 256-bit single-use token (SHA-256 stored), 30-min expiry, newest link only, revokes all sessions, generic responses, rate-limited. Disabled (HTTP 503 + UI notice) when SMTP is not configured. |
| 2 | Critical | **Personal data committed:** `db/finlytics.json` held real people's emails, names, bcrypt password hashes and financial records, publicly visible in the repo. | File deleted, `db/*.json` and other DB/backup files git-ignored, fictional `db/demo-data.example.json` added. History still contains it — see "Git history" below. |
| 3 | Critical | **Data loss on Vercel:** the JSON DB was copied to `/tmp` per serverless instance, so writes were lost on cold start and diverged between instances; concurrent writes could corrupt the file; `max(id)+1` ids could collide. | PostgreSQL with migrations, constraints, indexes, `SERIAL` ids and transactions. Sessions and rate limits also in PostgreSQL. |
| 4 | High | **Hardcoded session secret fallback** (`'finlytics-secret'`) allowed forging session cookies when `SESSION_SECRET` was unset. | Required (≥ 32 chars, not a placeholder) in production; random per-process in dev. |
| 5 | High | **Stored XSS:** merchant, category, emoji and color values were inserted with `innerHTML` and inline `onclick="…'${name}'…"`, and colors were interpolated into `style` attributes. | All rendering uses `textContent`/DOM APIs (`h()` helper); colors validated as `#RRGGBB` on server and client; inline handlers and inline scripts removed; strict CSP (`script-src 'self'`, `script-src-attr 'none'`); ESLint rule forbids HTML-string sinks. |
| 6 | High | **No CSRF protection** on cookie-authenticated, state-changing endpoints; **CORS reflected any origin with credentials** (`origin: true`), letting any website read users' financial data. | Session-bound CSRF token required on all non-GET API calls; CORS only for origins listed in `CORS_ORIGINS` (none by default). |
| 7 | High | **Insecure cookie / proxy settings:** `secure: false`, no `SameSite`, no `trust proxy`, memory session store (leaks, resets, not shared). | `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production, `trust proxy` configurable (default 1 on Vercel), PostgreSQL session store, session id rotated on login/register (fixation). |
| 8 | High | **No rate limiting** on login, registration or reset (password guessing, enumeration, spam). | Per-IP limits stored in PostgreSQL so they hold across instances; fail closed if the store is unavailable. |
| 9 | High | **Weak input validation:** negative/zero/`NaN`/`Infinity` amounts, impossible dates, any string as type/currency/theme, unbounded text lengths, `parseInt` on ids (`'1abc'` → 1), update path skipped validation, `Transactions.update` returned a row looked up without the owner filter. | `lib/validation.js` used by every route; create and update share one validator; DB `CHECK` constraints as a second line; ids strictly validated; all queries owner-scoped. |
| 10 | Medium | Category/budget duplicates and inconsistencies (same name twice, budgets for unknown categories, transactions in nonexistent categories). New accounts got no categories at all, so they could not add a transaction. | Case-insensitive unique indexes, upserts, category existence checks, default categories seeded at registration. |
| 11 | Medium | Errors: malformed JSON returned a 500, the error handler logged full stacks, and Express 4 would not catch rejected promises once queries became async; no explicit body size limit. | Express 5 (async errors handled), central error handler with generic messages, 16 kB JSON limit, `x-powered-by` off. |
| 12 | Medium | Demo account with a published password was auto-created on every start, including production. | Only via `npm run seed:demo`, refused in production; demo shortcut hidden unless `DEMO_MODE`. |
| 13 | Medium | Vulnerable/old dependencies (express 4.19 with path-to-regexp/body-parser/send advisories, lowdb 1, nodemon chain); Chart.js loaded unpinned from a CDN without SRI. | Express 5.3, bcryptjs 3, current helmet/pg/nodemailer; lowdb and nodemon removed; Chart.js 4.5.1 vendored. `npm audit`: 0 vulnerabilities. |
| 14 | Medium | Frontend reliability: no HTTP-error handling (success toasts after failed requests), double submissions, crashes on API failure, no expired-session handling, dates shifted a day in negative-UTC timezones, server-local vs. browser month mismatch, wrong decimals for JPY, mobile layout hid all navigation, broken settings markup, unused transaction count. | Central `Api` client (CSRF, timeouts, 401 → sign-in, malformed responses), `withBusy` on every submit, error/empty states, local-date handling, month passed from the browser, `Intl.NumberFormat`, bottom navigation on mobile, edit transaction and category management UI. |
| 15 | Low | Redundant root `index.html`/`app.js`/`style.css` (older standalone prototype, never served), `db/migrate_categories.js`. | Removed after confirming nothing referenced them. `public/` is the single entry point. |
| 16 | Low | Savings rate showed `0%` with no income; "Remaining in categories" showed `$0.00` in red when over budget; "50+ currencies" claim with 7 supported. | `—` when no income; shows amount over; label corrected. |

## Git history exposure (action needed by the repository owner)

`db/finlytics.json` is still present in commit `7bbd531` on `master` and in any clone or
fork. Removing it from the working tree does **not** remove it from history. It contains
two real people's emails, names and bcrypt password hashes, and their transactions.

Recommended, in this order:

1. **Assume the data is exposed.** bcrypt slows cracking but weak passwords can still be
   recovered. Ask the affected people to change their password (on Finlytics and anywhere
   they reused it), and do not import their old hashes if in doubt — they can use password recovery.
2. **Keep a private backup** of the file if you need to migrate it (see README), outside the repo.
3. **Rewrite history** (destructive; coordinate first, everyone must re-clone):
   ```bash
   git clone --mirror git@github.com:Abhiram23-magnus/finlytics-app.git
   cd finlytics-app.git
   git filter-repo --invert-paths --path db/finlytics.json   # pip install git-filter-repo
   git push --force --mirror
   ```
   Open pull requests keep old refs; close/recreate them after the rewrite.
4. **Ask GitHub Support to purge cached views** of the old commit, and check for forks.
5. Consider making the repository private until this is done.

This branch does not rewrite history; that needs your explicit go-ahead.

## Remaining risks and limitations

- **Unverified in this audit:** real SMTP delivery and the live Vercel deployment (no
  credentials available). Both are covered by tests with a fake mailer / local PostgreSQL.
- `style-src` allows `'unsafe-inline'` because the existing markup uses many `style=""`
  attributes. No user data reaches CSS (colors are validated), so the risk is low; moving
  styles into `style.css` would allow removing it.
- Registration returns 409 for an existing email, which lets someone check whether an
  email is registered (rate-limited). Hiding it would need email verification at sign-up.
- No email verification at sign-up and no MFA.
- Transaction lists are capped at 1,000 rows per request (no pagination UI yet).
- Rate limits are per IP; attackers with many IPs can still try passwords slowly. Long, unique passwords remain important.
- `forgot-password` waits for the SMTP send, so response time can differ slightly for existing accounts.
