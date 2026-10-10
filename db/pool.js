// ============================================================
// FINLYTICS — PostgreSQL connection pool
// ============================================================
'use strict';

const { Pool, types } = require('pg');

// NUMERIC (oid 1700) → JS number. Amounts are stored as NUMERIC(14,2), well
// within the exact-integer range of a double once scaled, so this is safe.
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
// DATE (oid 1082) → keep as 'YYYY-MM-DD' string; avoids timezone shifts.
types.setTypeParser(1082, v => v);

function sslOption(mode) {
  if (mode === 'disable') return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

function createPool(config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: sslOption(config.databaseSsl),
    max: config.dbPoolMax,
    idleTimeoutMillis: config.isVercel ? 5_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'finlytics',
  });
  // An idle client erroring (e.g. DB restart) must not crash the process.
  pool.on('error', err => console.error('[db] idle client error:', err.code || err.message));
  return pool;
}

/** Runs fn(client) inside a transaction; rolls back on any error. */
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
