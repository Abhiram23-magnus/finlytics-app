// ============================================================
// FINLYTICS — Analytics Routes
// ============================================================
'use strict';

const express        = require('express');
const router         = express.Router();
const requireAuth    = require('../middleware/requireAuth');
const { Analytics }  = require('../db/database');

router.use(requireAuth);

// GET /api/analytics/summary
router.get('/summary', (req, res) => {
  const data = Analytics.summary(req.session.userId);
  res.json(data);
});

// GET /api/analytics/trends
router.get('/trends', (req, res) => {
  const data = Analytics.trends(req.session.userId);
  res.json(data);
});

// GET /api/analytics/categories
router.get('/categories', (req, res) => {
  const data = Analytics.categories(req.session.userId);
  res.json(data);
});

// GET /api/analytics/heatmap
router.get('/heatmap', (req, res) => {
  const data = Analytics.heatmap(req.session.userId);
  res.json(data);
});

module.exports = router;
