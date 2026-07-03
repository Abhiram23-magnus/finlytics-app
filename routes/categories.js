// ============================================================
// FINLYTICS — Categories Routes
// ============================================================
'use strict';

const express        = require('express');
const router         = express.Router();
const requireAuth    = require('../middleware/requireAuth');
const { Categories } = require('../db/database');

router.use(requireAuth);

// GET /api/categories
router.get('/', (req, res) => {
  const { type } = req.query; // 'income' or 'expense'
  const cats = Categories.list(req.session.userId, type);
  res.json(cats);
});

// POST /api/categories
router.post('/', (req, res) => {
  const { type, name, emoji, color, bg } = req.body;
  if (!type || !name) {
    return res.status(400).json({ error: 'type and name are required' });
  }

  const newCat = Categories.create({
    user_id: req.session.userId,
    type,
    name,
    emoji: emoji || '🏷',
    color: color || '#10B981',
    bg: bg || 'rgba(16, 185, 129, 0.12)'
  });

  res.status(201).json(newCat);
});

// DELETE /api/categories/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  Categories.delete(id, req.session.userId);
  res.json({ message: 'Deleted', id });
});

module.exports = router;
