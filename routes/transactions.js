// ============================================================
// FINLYTICS — Transactions Routes
// ============================================================
'use strict';

const express           = require('express');
const router            = express.Router();
const requireAuth       = require('../middleware/requireAuth');
const { Transactions }  = require('../db/database');

router.use(requireAuth);

// GET /api/transactions
router.get('/', (req, res) => {
  const { type, category, search } = req.query;
  const items = Transactions.list(req.session.userId, { type, category, search });
  res.json(items);
});

// POST /api/transactions
router.post('/', (req, res) => {
  const { type, merchant, category, amount, date, notes, recurring } = req.body;

  if (!type || !merchant || !category || !amount || !date)
    return res.status(400).json({ error: 'type, merchant, category, amount, and date are required.' });

  if (!['income', 'expense'].includes(type))
    return res.status(400).json({ error: 'type must be income or expense.' });

  const txn = Transactions.create({
    user_id: req.session.userId, type, merchant, category,
    amount: parseFloat(amount), date, notes, recurring
  });
  res.status(201).json(txn);
});

// PUT /api/transactions/:id
router.put('/:id', (req, res) => {
  const id  = parseInt(req.params.id);
  const txn = Transactions.findById(id, req.session.userId);
  if (!txn) return res.status(404).json({ error: 'Transaction not found.' });

  const { type, merchant, category, amount, date, notes, recurring } = req.body;
  const updates = {};
  if (type      !== undefined) updates.type      = type;
  if (merchant  !== undefined) updates.merchant  = merchant.trim();
  if (category  !== undefined) updates.category  = category;
  if (amount    !== undefined) updates.amount    = parseFloat(amount);
  if (date      !== undefined) updates.date      = date;
  if (notes     !== undefined) updates.notes     = notes;
  if (recurring !== undefined) updates.recurring = Boolean(recurring);

  const updated = Transactions.update(id, req.session.userId, updates);
  res.json(updated);
});

// DELETE /api/transactions/:id
router.delete('/:id', (req, res) => {
  const id  = parseInt(req.params.id);
  const txn = Transactions.findById(id, req.session.userId);
  if (!txn) return res.status(404).json({ error: 'Transaction not found.' });

  Transactions.delete(id, req.session.userId);
  res.json({ message: 'Deleted', id });
});

module.exports = router;
