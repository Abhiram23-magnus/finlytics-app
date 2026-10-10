// ============================================================
// FINLYTICS — Analytics Routes
// ============================================================
'use strict';

const express     = require('express');
const requireAuth = require('../middleware/requireAuth');
const v           = require('../lib/validation');
const { currentMonthUTC } = require('../db/repository');

module.exports = function analyticsRoutes({ repo }) {
  const router = express.Router();
  router.use(requireAuth);

  // All endpoints accept ?month=YYYY-MM (the client's local month); default is the current UTC month.
  function monthOf(req) {
    const m = v.queryString(req, 'month');
    return m ? v.month(m) : currentMonthUTC();
  }

  router.get('/summary',    async (req, res) => res.json(await repo.Analytics.summary(req.session.userId, monthOf(req))));
  router.get('/trends',     async (req, res) => res.json(await repo.Analytics.trends(req.session.userId, monthOf(req))));
  router.get('/categories', async (req, res) => res.json(await repo.Analytics.categories(req.session.userId, monthOf(req))));
  router.get('/heatmap',    async (req, res) => res.json(await repo.Analytics.heatmap(req.session.userId, monthOf(req))));

  return router;
};
