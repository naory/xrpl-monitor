const { Router }                             = require('express');
const { getFills, getFillCount, clampLimit, MAX_LIMIT } = require('../db/fillQueries');
const { getVolumeLeaderboard, WINDOWS }      = require('../redis/volume');

function createFillsRouter({ pool, redis }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const rawLimit = req.query.limit;
    if (rawLimit !== undefined) {
      const n = parseInt(rawLimit, 10);
      if (!Number.isFinite(n) || n < 1 || n > MAX_LIMIT) {
        return res.status(400).json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` });
      }
    }

    try {
      const rows = await getFills(pool, {
        account:     req.query.account     || undefined,
        getCurrency: req.query.getCurrency || undefined,
        payCurrency: req.query.payCurrency || undefined,
        from:        req.query.from        || undefined,
        to:          req.query.to          || undefined,
        limit:       req.query.limit       || undefined,
        cursor:      req.query.cursor      || undefined,
      });

      const limit      = clampLimit(req.query.limit);
      const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

      res.json({ fills: rows, nextCursor });
    } catch (err) {
      console.error('[FILLS] Query error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/stats', async (req, res) => {
    const { window } = req.query;
    if (!window) {
      return res.status(400).json({ error: 'window query parameter is required (10m, 1h, 24h)' });
    }
    if (!WINDOWS[window]) {
      return res.status(400).json({ error: `Unknown window '${window}'. Valid values: ${Object.keys(WINDOWS).join(', ')}` });
    }

    try {
      const [volumeLeaderboard, totalFills] = await Promise.all([
        getVolumeLeaderboard(redis, window),
        getFillCount(pool),
      ]);

      res.json({ window, volumeLeaderboard, totalFills });
    } catch (err) {
      console.error('[FILLS/STATS] Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createFillsRouter };
