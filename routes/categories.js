// ============================================================
// FINLYTICS — Categories Routes
// ============================================================
'use strict';

const express     = require('express');
const requireAuth = require('../middleware/requireAuth');
const v           = require('../lib/validation');

module.exports = function categoryRoutes({ repo }) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/categories?type=income|expense
  router.get('/', async (req, res) => {
    const type = v.queryString(req, 'type');
    const filter = type ? v.oneOf(type, 'type', v.TXN_TYPES) : undefined;
    res.json(await repo.Categories.list(req.session.userId, filter));
  });

  // POST /api/categories
  router.post('/', async (req, res) => {
    const b = v.body(req);
    const cat = {
      type:  v.oneOf(b.type, 'type', v.TXN_TYPES),
      name:  v.text(b.name, 'name', { max: 40 }),
      emoji: v.emoji(b.emoji, 'emoji', '🏷'),
      color: v.color(b.color, 'color', '#10B981'),
    };
    const created = await repo.Categories.create(req.session.userId, cat);
    if (!created) return res.status(409).json({ error: `A ${cat.type} category named "${cat.name}" already exists.` });
    return res.status(201).json(created);
  });

  // DELETE /api/categories/:id — existing transactions keep their category label.
  router.delete('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    const deleted = await repo.Categories.delete(req.session.userId, id);
    if (!deleted) return res.status(404).json({ error: 'Category not found.' });
    return res.json({ message: 'Deleted', id });
  });

  return router;
};
