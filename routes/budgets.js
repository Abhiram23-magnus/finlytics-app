// ============================================================
// FINLYTICS — Budgets Routes
// ============================================================
'use strict';

const express     = require('express');
const requireAuth = require('../middleware/requireAuth');
const v           = require('../lib/validation');
const { currentMonthUTC } = require('../db/repository');

module.exports = function budgetRoutes({ repo }) {
  const router = express.Router();
  router.use(requireAuth);

  // ── Monthly overall budget ──

  // GET /api/budgets/monthly?month=YYYY-MM
  router.get('/monthly', async (req, res) => {
    const month = v.month(v.queryString(req, 'month'));
    res.json({ budget: await repo.MonthlyBudgets.get(req.session.userId, month) });
  });

  // POST /api/budgets/monthly  { month, amount }
  router.post('/monthly', async (req, res) => {
    const b = v.body(req);
    const month  = v.month(b.month);
    const amount = v.amount(b.amount);
    const budget = await repo.MonthlyBudgets.upsert(req.session.userId, month, amount);
    res.status(201).json({ budget, message: 'Monthly budget saved' });
  });

  // ── Category budgets ──

  // GET /api/budgets?month=YYYY-MM — category budgets with the amount spent that month
  router.get('/', async (req, res) => {
    const m = v.queryString(req, 'month');
    const month = m ? v.month(m) : currentMonthUTC();
    res.json(await repo.Budgets.list(req.session.userId, month));
  });

  // POST /api/budgets — create, or update the limit of an existing category budget
  router.post('/', async (req, res) => {
    const b = v.body(req);
    const categoryName = v.text(b.category, 'category', { max: 40 });
    const category = await repo.Categories.findByName(req.session.userId, categoryName);
    if (!category || category.type !== 'expense') {
      return res.status(400).json({ error: `Unknown expense category "${categoryName}".`, field: 'category' });
    }
    const budget = await repo.Budgets.upsert(req.session.userId, {
      category: category.name,
      limit_amount: v.amount(b.limit_amount, 'limit_amount'),
      emoji: category.emoji,
      color: category.color,
    });
    res.status(201).json(budget);
  });

  // DELETE /api/budgets/:id
  router.delete('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    const deleted = await repo.Budgets.delete(req.session.userId, id);
    if (!deleted) return res.status(404).json({ error: 'Budget not found.' });
    return res.json({ message: 'Deleted', id });
  });

  return router;
};
