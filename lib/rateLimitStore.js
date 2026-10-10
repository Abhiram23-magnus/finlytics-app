// ============================================================
// FINLYTICS — PostgreSQL store for express-rate-limit
// ============================================================
// In-memory counters reset per serverless instance, which makes them useless
// on Vercel. This store keeps fixed-window counters in a shared table.
'use strict';

class PgRateLimitStore {
  constructor(pool, prefix) {
    this.pool = pool;
    this.prefix = prefix;
    this.localKeys = false; // counters are shared across processes
  }

  init(options) { this.windowMs = options.windowMs; }

  key(k) { return `${this.prefix}:${k}`.slice(0, 300); }

  async increment(key) {
    const { rows } = await this.pool.query(
      `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + ($2 || ' milliseconds')::interval)
       ON CONFLICT (key) DO UPDATE SET
         hits     = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      [this.key(key), String(this.windowMs)]);
    // Opportunistic cleanup of stale rows (~1% of calls)
    if (Math.random() < 0.01) {
      this.pool.query("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour'").catch(() => {});
    }
    return { totalHits: rows[0].hits, resetTime: new Date(rows[0].reset_at) };
  }

  async decrement(key) {
    await this.pool.query('UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1', [this.key(key)]);
  }

  async resetKey(key) {
    await this.pool.query('DELETE FROM rate_limits WHERE key = $1', [this.key(key)]);
  }
}

module.exports = { PgRateLimitStore };
