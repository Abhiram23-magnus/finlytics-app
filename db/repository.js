// ============================================================
// FINLYTICS — Data access layer (PostgreSQL)
// ============================================================
// Every query that touches user data is scoped by user_id. Callers pass the
// authenticated user's id from the session; ids from the request are only
// ever used together with that user_id.
'use strict';

const { withTransaction } = require('./pool');

const DEFAULT_CATEGORIES = [
  { type: 'expense', name: 'Food',          emoji: '🍔', color: '#10B981' },
  { type: 'expense', name: 'Transport',     emoji: '🚗', color: '#3B82F6' },
  { type: 'expense', name: 'Shopping',      emoji: '🛍', color: '#8B5CF6' },
  { type: 'expense', name: 'Bills',         emoji: '⚡', color: '#EF4444' },
  { type: 'expense', name: 'Entertainment', emoji: '🎬', color: '#F59E0B' },
  { type: 'expense', name: 'Health',        emoji: '❤️', color: '#14B8A6' },
  { type: 'expense', name: 'Travel',        emoji: '✈️', color: '#06B6D4' },
  { type: 'expense', name: 'Education',     emoji: '📚', color: '#6366F1' },
  { type: 'income',  name: 'Salary',        emoji: '💼', color: '#10B981' },
  { type: 'income',  name: 'Freelance',     emoji: '💻', color: '#3B82F6' },
  { type: 'income',  name: 'Investment',    emoji: '📈', color: '#8B5CF6' },
  { type: 'income',  name: 'Other',         emoji: '💰', color: '#F59E0B' },
];

const USER_PUBLIC = 'id, name, email, currency, theme, created_at';
const TXN_COLS    = 'id, type, merchant, category, amount, date, notes, recurring, created_at, updated_at';
const CAT_COLS    = 'id, type, name, emoji, color';

function currentMonthUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' → [firstDay, firstDayOfNextMonth) as 'YYYY-MM-DD' strings. */
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const next  = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return [start, next];
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function round2(n) { return Math.round(n * 100) / 100; }

function escapeLike(s) { return s.replace(/[\\%_]/g, c => '\\' + c); }

function createRepository(pool) {
  const q = (sql, params) => pool.query(sql, params);

  async function seedDefaultCategories(client, userId) {
    for (const c of DEFAULT_CATEGORIES) {
      await client.query(
        `INSERT INTO categories (user_id, type, name, emoji, color) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [userId, c.type, c.name, c.emoji, c.color]);
    }
  }

  // ── Users ─────────────────────────────────────────────────
  const Users = {
    /** Includes password_hash — only for authentication code paths. */
    async findAuthByEmail(email) {
      const { rows } = await q(`SELECT ${USER_PUBLIC}, password_hash FROM users WHERE email = $1`, [email]);
      return rows[0] || null;
    },

    async findById(id) {
      const { rows } = await q(`SELECT ${USER_PUBLIC} FROM users WHERE id = $1`, [id]);
      return rows[0] || null;
    },

    /** Creates a user and their default categories atomically. Returns null on duplicate email. */
    async create({ name, email, passwordHash, currency }) {
      return withTransaction(pool, async client => {
        const { rows } = await client.query(
          `INSERT INTO users (name, email, password_hash, currency) VALUES ($1,$2,$3,$4)
           ON CONFLICT (email) DO NOTHING RETURNING ${USER_PUBLIC}`,
          [name, email, passwordHash, currency]);
        if (!rows[0]) return null;
        await seedDefaultCategories(client, rows[0].id);
        return rows[0];
      });
    },

    async updatePrefs(id, { currency, theme, name }) {
      const { rows } = await q(
        `UPDATE users SET currency = COALESCE($2, currency), theme = COALESCE($3, theme),
                name = COALESCE($4, name), updated_at = now()
         WHERE id = $1 RETURNING ${USER_PUBLIC}`,
        [id, currency ?? null, theme ?? null, name ?? null]);
      return rows[0] || null;
    },

    /** Sets a new password hash and revokes every session belonging to the user. */
    async setPasswordAndRevokeSessions(client, id, passwordHash) {
      await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [id, passwordHash]);
      await client.query("DELETE FROM session WHERE (sess->>'userId')::text = $1::text", [String(id)]);
    },
  };

  // ── Password reset tokens ─────────────────────────────────
  const ResetTokens = {
    async create(userId, tokenHash, ttlMs) {
      return withTransaction(pool, async client => {
        // Only the newest token is valid.
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
          [userId, tokenHash, String(ttlMs)]);
      });
    },

    /**
     * Atomically consumes a token and sets the new password. Returns the user id,
     * or null if the token is unknown, expired, or already used.
     */
    async consumeAndResetPassword(tokenHash, passwordHash) {
      return withTransaction(pool, async client => {
        const { rows } = await client.query(
          `UPDATE password_reset_tokens SET used_at = now()
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
           RETURNING user_id`, [tokenHash]);
        if (!rows[0]) return null;
        const userId = rows[0].user_id;
        await Users.setPasswordAndRevokeSessions(client, userId, passwordHash);
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1 AND token_hash <> $2', [userId, tokenHash]);
        return userId;
      });
    },

    async purgeExpired() {
      await q("DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'");
    },
  };

  // ── Categories ────────────────────────────────────────────
  const Categories = {
    async list(userId, type) {
      const { rows } = type
        ? await q(`SELECT ${CAT_COLS} FROM categories WHERE user_id = $1 AND type = $2 ORDER BY id`, [userId, type])
        : await q(`SELECT ${CAT_COLS} FROM categories WHERE user_id = $1 ORDER BY id`, [userId]);
      return rows;
    },

    async exists(userId, type, name) {
      const { rowCount } = await q(
        'SELECT 1 FROM categories WHERE user_id = $1 AND type = $2 AND lower(name) = lower($3)', [userId, type, name]);
      return rowCount > 0;
    },

    async findByName(userId, name) {
      const { rows } = await q(
        `SELECT ${CAT_COLS} FROM categories WHERE user_id = $1 AND lower(name) = lower($2) ORDER BY type = 'expense' DESC LIMIT 1`,
        [userId, name]);
      return rows[0] || null;
    },

    /** Returns null when a category with that name already exists for the type. */
    async create(userId, { type, name, emoji, color }) {
      const { rows } = await q(
        `INSERT INTO categories (user_id, type, name, emoji, color) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING RETURNING ${CAT_COLS}`,
        [userId, type, name, emoji, color]);
      return rows[0] || null;
    },

    async delete(userId, id) {
      const { rowCount } = await q('DELETE FROM categories WHERE id = $1 AND user_id = $2', [id, userId]);
      return rowCount > 0;
    },
  };

  // ── Transactions ──────────────────────────────────────────
  const Transactions = {
    async list(userId, { type, category, search, month, limit } = {}) {
      const where = ['user_id = $1'];
      const params = [userId];
      if (type) { params.push(type); where.push(`type = $${params.length}`); }
      if (category) { params.push(category); where.push(`category = $${params.length}`); }
      if (month) {
        const [start, end] = monthRange(month);
        params.push(start, end);
        where.push(`date >= $${params.length - 1} AND date < $${params.length}`);
      }
      if (search) {
        params.push(`%${escapeLike(search)}%`);
        where.push(`(merchant ILIKE $${params.length} OR category ILIKE $${params.length} OR notes ILIKE $${params.length})`);
      }
      params.push(limit || 1000);
      const { rows } = await q(
        `SELECT ${TXN_COLS} FROM transactions WHERE ${where.join(' AND ')}
         ORDER BY date DESC, id DESC LIMIT $${params.length}`, params);
      return rows;
    },

    async count(userId) {
      const { rows } = await q('SELECT count(*)::int AS n FROM transactions WHERE user_id = $1', [userId]);
      return rows[0].n;
    },

    async findById(userId, id) {
      const { rows } = await q(`SELECT ${TXN_COLS} FROM transactions WHERE id = $1 AND user_id = $2`, [id, userId]);
      return rows[0] || null;
    },

    async create(userId, t) {
      const { rows } = await q(
        `INSERT INTO transactions (user_id, type, merchant, category, amount, date, notes, recurring)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${TXN_COLS}`,
        [userId, t.type, t.merchant, t.category, t.amount, t.date, t.notes, t.recurring]);
      return rows[0];
    },

    /** Full replacement of the editable fields; scoped to the owner. */
    async update(userId, id, t) {
      const { rows } = await q(
        `UPDATE transactions SET type = $3, merchant = $4, category = $5, amount = $6, date = $7,
                notes = $8, recurring = $9, updated_at = now()
         WHERE id = $1 AND user_id = $2 RETURNING ${TXN_COLS}`,
        [id, userId, t.type, t.merchant, t.category, t.amount, t.date, t.notes, t.recurring]);
      return rows[0] || null;
    },

    async delete(userId, id) {
      const { rowCount } = await q('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, userId]);
      return rowCount > 0;
    },
  };

  // ── Category budgets ──────────────────────────────────────
  const Budgets = {
    /** Category budgets with the amount spent in `month`. */
    async list(userId, month) {
      const [start, end] = monthRange(month);
      const { rows } = await q(
        `SELECT b.id, b.category, b.limit_amount, b.emoji, b.color,
                COALESCE((SELECT SUM(t.amount) FROM transactions t
                          WHERE t.user_id = b.user_id AND t.type = 'expense'
                            AND lower(t.category) = lower(b.category)
                            AND t.date >= $2 AND t.date < $3), 0)::numeric(14,2) AS spent
         FROM budgets b WHERE b.user_id = $1 ORDER BY b.category`, [userId, start, end]);
      return rows;
    },

    async upsert(userId, { category, limit_amount, emoji, color }) {
      const { rows } = await q(
        `INSERT INTO budgets (user_id, category, limit_amount, emoji, color) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, lower(category)) DO UPDATE
           SET limit_amount = EXCLUDED.limit_amount, emoji = EXCLUDED.emoji, color = EXCLUDED.color, updated_at = now()
         RETURNING id, category, limit_amount, emoji, color`,
        [userId, category, limit_amount, emoji, color]);
      return rows[0];
    },

    async delete(userId, id) {
      const { rowCount } = await q('DELETE FROM budgets WHERE id = $1 AND user_id = $2', [id, userId]);
      return rowCount > 0;
    },
  };

  // ── Monthly (overall) budgets ─────────────────────────────
  const MonthlyBudgets = {
    async get(userId, month) {
      const { rows } = await q('SELECT id, month, amount FROM monthly_budgets WHERE user_id = $1 AND month = $2', [userId, month]);
      return rows[0] || null;
    },

    async upsert(userId, month, amount) {
      const { rows } = await q(
        `INSERT INTO monthly_budgets (user_id, month, amount) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, month) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()
         RETURNING id, month, amount`, [userId, month, amount]);
      return rows[0];
    },
  };

  // ── Analytics ─────────────────────────────────────────────
  const Analytics = {
    async summary(userId, month) {
      const [start, end] = monthRange(month);
      const { rows } = await q(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)  AS total_income,
           COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS total_expenses,
           COALESCE(SUM(amount) FILTER (WHERE type = 'income'  AND date >= $2 AND date < $3), 0) AS month_income,
           COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND date >= $2 AND date < $3), 0) AS month_expenses
         FROM transactions WHERE user_id = $1`, [userId, start, end]);
      const r = rows[0];
      const monthlyIncome   = round2(r.month_income);
      const monthlyExpenses = round2(r.month_expenses);
      return {
        month,
        balance: round2(r.total_income - r.total_expenses),
        totalIncome: round2(r.total_income),
        totalExpenses: round2(r.total_expenses),
        monthlyIncome,
        monthlyExpenses,
        monthlyNet: round2(monthlyIncome - monthlyExpenses),
        // % of this month's income that was not spent; null when there is no income to compare against
        savingsRate: monthlyIncome > 0 ? Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100) : null,
      };
    },

    /** Income/expense totals for the 6 months ending at `month` (inclusive). */
    async trends(userId, month) {
      const first = shiftMonth(month, -5);
      const [start] = monthRange(first);
      const [, end] = monthRange(month);
      const { rows } = await q(
        `SELECT to_char(date, 'YYYY-MM') AS m,
                COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)  AS income,
                COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expenses
         FROM transactions WHERE user_id = $1 AND date >= $2 AND date < $3
         GROUP BY m`, [userId, start, end]);
      const byMonth = new Map(rows.map(r => [r.m, r]));
      return Array.from({ length: 6 }, (_, i) => {
        const key = shiftMonth(first, i);
        const r = byMonth.get(key);
        return {
          key,
          month: MONTH_LABELS[Number(key.slice(5)) - 1],
          income: round2(r ? r.income : 0),
          expenses: round2(r ? r.expenses : 0),
        };
      });
    },

    async categories(userId, month) {
      const [start, end] = monthRange(month);
      const { rows } = await q(
        `SELECT category, SUM(amount)::numeric(14,2) AS total FROM transactions
         WHERE user_id = $1 AND type = 'expense' AND date >= $2 AND date < $3
         GROUP BY category ORDER BY total DESC, category`, [userId, start, end]);
      return rows;
    },

    async heatmap(userId, month) {
      const [start, end] = monthRange(month);
      const { rows } = await q(
        `SELECT date, SUM(amount)::numeric(14,2) AS total FROM transactions
         WHERE user_id = $1 AND type = 'expense' AND date >= $2 AND date < $3
         GROUP BY date ORDER BY date`, [userId, start, end]);
      return rows;
    },
  };

  return { Users, ResetTokens, Categories, Transactions, Budgets, MonthlyBudgets, Analytics };
}

module.exports = { createRepository, DEFAULT_CATEGORIES, currentMonthUTC, monthRange, shiftMonth };
