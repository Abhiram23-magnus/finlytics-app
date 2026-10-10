// ============================================================
// FINLYTICS — Minimal forward-only SQL migration runner
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_KEY = 74_201_337; // arbitrary constant for pg_advisory_lock

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort();
}

/**
 * Applies pending migrations in order. Each migration runs in its own
 * transaction, and an advisory lock prevents two deploys migrating at once.
 * Returns the list of newly applied migration names.
 */
async function migrate(pool, { log = () => {} } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map(r => r.name));

    for (const file of listMigrations()) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        err.message = `Migration ${file} failed: ${err.message}`;
        throw err;
      }
      applied.push(file);
      log(`  ✅  Applied migration ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
  return applied;
}

/** Returns migration files that have not been applied yet. */
async function pendingMigrations(pool) {
  const exists = await pool.query("SELECT to_regclass('public.schema_migrations') AS t");
  const all = listMigrations();
  if (!exists.rows[0].t) return all;
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map(r => r.name));
  return all.filter(f => !done.has(f));
}

module.exports = { migrate, pendingMigrations };
