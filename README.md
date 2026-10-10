# Finlytics

Personal expense tracker: income and expense transactions, custom categories,
category budgets, an overall monthly budget, dashboard analytics, multiple
every ISO 4217 currency in current use (157) and dark mode.

- **Backend:** Node.js 20+, Express 5, PostgreSQL (via `pg`), server-side sessions stored in PostgreSQL
- **Frontend:** plain HTML/CSS/JS in `public/` (no build step), Chart.js vendored locally
- **Deployment target:** Vercel (`vercel.json`), or any Node host with PostgreSQL

See [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) for the audit findings, what was fixed, and remaining risks.

## Architecture

```
Browser ──► Express app (server.js → lib/createApp.js)
             ├─ helmet (CSP, HSTS, …), CORS allowlist, 16 kB JSON limit
             ├─ express-session  ──► PostgreSQL "session" table
             ├─ rate limits      ──► PostgreSQL "rate_limits" table (shared by all instances)
             ├─ CSRF check (X-CSRF-Token header, session-bound token)
             ├─ routes/*  → lib/validation.js → db/repository.js ──► PostgreSQL
             └─ static files from public/
```

Every query that reads or changes user data is scoped by the signed-in user's id
(`db/repository.js`), so one user can never read or modify another user's records.

### Folder structure

```
server.js                 Entry point (local listen; exported handler on Vercel)
lib/
  config.js               Environment parsing + validation (fails fast on bad config)
  createApp.js            Express app factory (middleware order, security headers, routes)
  validation.js           Server-side validators for every input
  mailer.js               SMTP email for password recovery (disabled if not configured)
  rateLimitStore.js       PostgreSQL store for express-rate-limit
middleware/
  requireAuth.js          401 unless signed in
  csrf.js                 Synchronizer-token CSRF protection
  errorHandler.js         Central error handler (no stack traces / internals in responses)
routes/                   auth, transactions, categories, budgets, analytics
db/
  pool.js                 pg Pool + transaction helper
  migrate.js              Forward-only SQL migration runner (advisory-locked)
  migrations/*.sql        Schema, constraints, indexes
  repository.js           All SQL queries
  demo-data.example.json  Fictional sample in the legacy JSON format (import testing)
scripts/
  migrate.js              npm run migrate
  seed-demo.js            npm run seed:demo  (fictional demo account; refuses in production)
  import-json.js          One-time import from the legacy lowdb JSON file
public/
  index.html, app.js      Dashboard
  login.html, login.js    Sign in / register / password recovery
  common.js               API client, safe DOM helpers, formatting
  style.css, vendor/      Styles, vendored Chart.js
  background-video.js     Decorative background video loader (sign-in hero)
  media/                  Sign-in hero video (WebM + MP4, ~1 MB each) and poster image
test/                     node:test API/integration tests + Playwright browser checks
```

## Local development

Prerequisites: Node.js 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL and SESSION_SECRET
createdb finlytics              # or create the database any other way
npm run migrate                 # create tables
npm run seed:demo               # optional: fictional demo account demo@finlytics.app / demo1234
npm run dev                     # migrates, then starts with auto-reload on http://localhost:3000
```

`npm start` runs the server without auto-reload. It refuses to start if migrations are pending.

## Environment variables

All variables are documented in [`.env.example`](.env.example). Summary:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | always | PostgreSQL connection string. Use the provider's **pooled** URL on serverless. |
| `SESSION_SECRET` | production | ≥ 32 random characters (`openssl rand -hex 32`). In development a random one is generated per start. |
| `NODE_ENV` | production | `production` enables secure cookies, HSTS, TLS to the DB and stricter checks. |
| `DATABASE_SSL` | no | `require` (default in production, verifies certificates), `no-verify`, or `disable` (dev default). |
| `APP_BASE_URL` | with SMTP | Public https URL used in reset links. Never derived from the request's Host header. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | no | Email delivery for password recovery. Without `SMTP_HOST`, recovery is disabled. |
| `TRUST_PROXY` | no | Proxy hops to trust for client IP / HTTPS detection. Default `1` on Vercel, off elsewhere. |
| `CORS_ORIGINS` | no | Comma-separated extra origins allowed to call the API. Empty = same-origin only. |
| `DEMO_MODE` | no | Shows the demo-account shortcut on the login page (default on in dev, off in production). |
| `DB_POOL_MAX`, `RESET_TOKEN_TTL_MINUTES`, `RATE_LIMIT_*` | no | Tuning; see `.env.example`. |

The app validates configuration at startup and exits with a readable message if
something required is missing. Secret values are never printed.

## Database setup and migrations

- Schema lives in `db/migrations/NNN_name.sql` and is applied in order by `npm run migrate`.
  Applied migrations are recorded in `schema_migrations`; each runs in its own transaction
  under a PostgreSQL advisory lock, so concurrent deploys cannot apply one twice.
- Constraints enforce data integrity even if application validation is bypassed:
  positive amounts ≤ 1 billion with 2 decimals, valid dates, `income`/`expense` types,
  hex colors, one category name per type per user (case-insensitive), one budget per
  category per user, one overall budget per user per month, unique emails, and
  `ON DELETE CASCADE` from users to their data.
- To add a migration, create the next numbered `.sql` file. Never edit an applied one.

### Migrating from the old JSON database (`db/finlytics.json`)

The previous version stored everything in `db/finlytics.json`. That file is no longer
in the repository (it contained personal data). To bring existing accounts across:

1. **Back up first.** Keep a copy of the JSON file outside the repository, and back up the
   target database (`pg_dump "$DATABASE_URL" > backup-$(date +%F).sql`).
   If you no longer have the file locally, recover it from the old commit:
   `git show 7bbd531:db/finlytics.json > ~/finlytics-backup.json` (store it somewhere private).
2. Run the migrations against the target database: `npm run migrate`.
3. Dry run (writes nothing, prints counts only):
   `node scripts/import-json.js ~/finlytics-backup.json --dry-run`
4. Import: `node scripts/import-json.js ~/finlytics-backup.json`

The import runs in a single transaction (all or nothing), keeps existing bcrypt
password hashes so people keep their passwords, never overwrites an email that
already exists, creates any categories referenced by transactions, and skips
(and counts) records that fail validation, such as negative amounts or impossible
dates. It never prints record contents. Re-running it is safe.

## Testing

Tests need a **separate, disposable** PostgreSQL database whose name contains `test`
(the suite drops and recreates its schema):

```bash
createdb finlytics_test
export TEST_DATABASE_URL=postgres://USER:PASS@localhost:5432/finlytics_test
npm run lint          # ESLint (also forbids innerHTML-style sinks in public/)
npm test              # API + integration tests (node:test + supertest)
npm run test:e2e      # browser checks in headless Chromium (Playwright)
```

`npm run test:e2e` needs a Chromium build (`npx playwright-core install chromium`, or set
`CHROMIUM_PATH`). Set `E2E_SCREENSHOTS=/some/dir` to save screenshots.

What is covered: registration, login, logout, password recovery (enabled and disabled),
session fixation, expired/revoked sessions, unauthenticated access, CSRF, rate limits,
transaction CRUD and validation (amounts, dates, types, ids, malformed and oversized
bodies), cross-user isolation for every resource, categories, budgets and monthly
summaries with exact cents, XSS payloads, security headers, cookies and CORS, legacy
import, config validation, persistence across restarts and multiple app instances,
and concurrent writes. The browser checks cover the dashboard, add/edit/delete/search,
duplicate-submit prevention, failed and offline API calls, categories, budgets,
currency and theme preferences, session expiry, and the mobile layout.

## Production deployment (Vercel)

1. Create a PostgreSQL database (Neon, Supabase, Vercel Postgres, RDS, …). Copy its
   **pooled** connection string.
2. In the Vercel project settings → Environment Variables, set at least
   `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET` (new random value), and
   `APP_BASE_URL=https://your-domain`. Add the `SMTP_*` and `MAIL_FROM` variables to
   enable password recovery.
3. From your machine, apply migrations to that database **before** deploying code that needs them:
   `DATABASE_URL="<production url>" NODE_ENV=production SESSION_SECRET=x… npm run migrate`
   (`SESSION_SECRET` only has to pass validation for this command).
4. Deploy (`vercel --prod` or push to the connected branch).
5. Check `https://your-domain/api/health` returns `{"status":"ok"}`.

Notes for serverless: sessions and rate-limit counters live in PostgreSQL, so every
instance shares them; nothing is written to the local filesystem. The pool is small
(`DB_POOL_MAX`, default 3 on Vercel) and idle connections close quickly; use a pooled
connection string so many concurrent instances do not exhaust database connections.

Other hosts: run `npm ci --omit=dev && npm run migrate && npm start` behind an HTTPS
reverse proxy and set `TRUST_PROXY` to the number of proxy hops.

## Security configuration

- Passwords: bcrypt (cost 12), 8–72 characters. Login responses do not reveal whether an email exists.
- Sessions: server-side in PostgreSQL; cookie is `HttpOnly`, `SameSite=Lax`, and in production
  `Secure` with the `__Host-` prefix; session id is rotated at login and registration; 7-day lifetime.
- CSRF: every non-GET API call must send the session's token in `X-CSRF-Token` (the frontend does this).
- Rate limits (per IP, shared across instances): failed logins 10/15 min, registrations 5/15 min,
  password-reset requests 5/15 min, all API calls 600/min. Limits cannot be disabled in production.
- Headers: strict CSP (`script-src 'self'`, no inline scripts or handlers), HSTS in production,
  `frame-ancestors 'none'`, `nosniff`, `no-referrer`.
- Request bodies: JSON only, 16 kB maximum. All input is validated on the server.
- Errors: responses never include stack traces, SQL errors, tokens or passwords; logs never include request bodies.

### Password recovery

`Forgot?` on the login page emails a link containing a 256-bit random token. Only its
SHA-256 hash is stored; it expires after 30 minutes (`RESET_TOKEN_TTL_MINUTES`), works
once, is replaced if another link is requested, and using it signs out every existing
session for that account. Responses are identical whether or not the email exists.
If SMTP is not configured the feature is switched off on both server (HTTP 503) and UI.

### Recovery procedures

- **Rotate the session secret** (signs everyone out): set a new `SESSION_SECRET` and redeploy.
  To end sessions immediately: `DELETE FROM session;`
- **Lock out a compromised account:** `DELETE FROM session WHERE sess->>'userId' = '<id>';`
  then have the person use password recovery (or set a new bcrypt hash).
- **Restore data:** restore the latest `pg_dump` backup into a new database, verify, then switch `DATABASE_URL`.
  Enable your provider's automated backups / point-in-time recovery for production.
- **Leaked database URL or SMTP password:** rotate the credential at the provider, update the
  environment variable, redeploy.
