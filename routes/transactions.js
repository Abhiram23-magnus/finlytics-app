// ============================================================
// FINLYTICS — Transactions Routes
// ============================================================
'use strict';

const express     = require('express');
const requireAuth = require('../middleware/requireAuth');
const v           = require('../lib/validation');

/** Validates a full transaction payload (shared by create and update). */
function parseTransaction(b) {
  return {
    type:      v.oneOf(b.type, 'type', v.TXN_TYPES),
    merchant:  v.text(b.merchant, 'merchant', { max: 100 }),
    category:  v.text(b.category, 'category', { max: 40 }),
    amount:    v.amount(b.amount),
    date:      v.date(b.date),
    notes:     v.multiline(b.notes, 'notes', { max: 500 }),
    recurring: v.boolean(b.recurring, 'recurring'),
  };
}

module.exports = function transactionRoutes({ repo }) {
  const router = express.Router();
  router.use(requireAuth);

  async function assertCategory(userId, txn) {
    const ok = await repo.Categories.exists(userId, txn.type, txn.category);
    if (!ok) throw new v.ValidationError(`Unknown ${txn.type} category "${txn.category}".`, 'category');
  }

  // GET /api/transactions?type=&category=&search=&month=
  router.get('/', async (req, res) => {
    const type     = v.queryString(req, 'type');
    const category = v.queryString(req, 'category');
    const search   = v.queryString(req, 'search');
    const month    = v.queryString(req, 'month');
    const limit    = v.queryString(req, 'limit');
    const filters  = {};
    if (type && type !== 'all') filters.type = v.oneOf(type, 'type', v.TXN_TYPES);
    if (category && category !== 'all') filters.category = v.text(category, 'category', { max: 40 });
    if (search) filters.search = v.text(search, 'search', { max: 100, required: false });
    if (month) filters.month = v.month(month);
    if (limit) {
      if (!/^\d{1,4}$/.test(limit) || Number(limit) < 1 || Number(limit) > 1000) throw new v.ValidationError('limit must be between 1 and 1000.', 'limit');
      filters.limit = Number(limit);
    }
    res.json(await repo.Transactions.list(req.session.userId, filters));
  });

  // GET /api/transactions/:id
  router.get('/:id', async (req, res) => {
    const txn = await repo.Transactions.findById(req.session.userId, v.id(req.params.id));
    if (!txn) return res.status(404).json({ error: 'Transaction not found.' });
    return res.json(txn);
  });

  // POST /api/transactions
  router.post('/', async (req, res) => {
    const txn = parseTransaction(v.body(req));
    await assertCategory(req.session.userId, txn);
    res.status(201).json(await repo.Transactions.create(req.session.userId, txn));
  });

  // PUT /api/transactions/:id — fields omitted keep their current value; the
  // merged result is validated exactly like a create.
  router.put('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    const existing = await repo.Transactions.findById(req.session.userId, id);
    if (!existing) return res.status(404).json({ error: 'Transaction not found.' });

    const b = v.body(req);
    const merged = {};
    for (const k of ['type', 'merchant', 'category', 'amount', 'date', 'notes', 'recurring']) {
      merged[k] = b[k] !== undefined ? b[k] : existing[k];
    }
    const txn = parseTransaction(merged);
    if (txn.type !== existing.type || txn.category !== existing.category) {
      await assertCategory(req.session.userId, txn);
    }
    const updated = await repo.Transactions.update(req.session.userId, id, txn);
    if (!updated) return res.status(404).json({ error: 'Transaction not found.' });
    return res.json(updated);
  });

  // DELETE /api/transactions/:id
  router.delete('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    const deleted = await repo.Transactions.delete(req.session.userId, id);
    if (!deleted) return res.status(404).json({ error: 'Transaction not found.' });
    return res.json({ message: 'Deleted', id });
  });

  return router;
};
