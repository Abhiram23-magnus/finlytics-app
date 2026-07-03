// ============================================================
// FINLYTICS — Budgets Routes
// ============================================================
'use strict';

const express        = require('express');
const router         = express.Router();
const requireAuth    = require('../middleware/requireAuth');
const { Budgets, MonthlyBudgets } = require('../db/database');

router.use(requireAuth);

// ── Monthly Overarching Budget ──

// GET /api/budgets/monthly?month=YYYY-MM
router.get('/monthly', (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required' });

  const budget = MonthlyBudgets.get(req.session.userId, month);
  res.json({ budget });
});

// POST /api/budgets/monthly
router.post('/monthly', (req, res) => {
  const { month, amount } = req.body;
  if (!month || !amount) return res.status(400).json({ error: 'month and amount required' });

  const budget = MonthlyBudgets.upsert(req.session.userId, month, parseFloat(amount));
  res.status(201).json({ budget, message: 'Monthly budget saved' });
});


// ── Category Budgets ──

// GET /api/budgets — returns category budgets enriched with spent amounts
router.get('/', (req, res) => {
  const budgets = Budgets.list(req.session.userId);
  res.json(budgets);
});

// POST /api/budgets — create or upsert by category
router.post('/', (req, res) => {
  const { category, limit_amount, emoji = '💳', color = '#6366F1' } = req.body;

  if (!category || !limit_amount)
    return res.status(400).json({ error: 'category and limit_amount are required.' });

  const budget = Budgets.upsert({
    user_id: req.session.userId,
    category,
    limit_amount: parseFloat(limit_amount),
    emoji,
    color,
  });
  res.status(201).json(budget);
});

// DELETE /api/budgets/:id
router.delete('/:id', (req, res) => {
  const id     = parseInt(req.params.id);
  const budget = Budgets.findById(id, req.session.userId);
  if (!budget) return res.status(404).json({ error: 'Budget not found.' });

  Budgets.delete(id, req.session.userId);
  res.json({ message: 'Deleted', id });
});

module.exports = router;
