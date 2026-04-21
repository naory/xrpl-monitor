const { Router }                             = require('express');
const { getFills, getFillCount, clampLimit, MAX_LIMIT } = require('../db/fillQueries');
const { getVolumeLeaderboard, WINDOWS }      = require('../redis/volume');
const { parsePairKey, getOhlcv }             = require('../db/ohlcv');

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
      const { rows, hasMore } = await getFills(pool, {
        account:     req.query.account     || undefined,
        getCurrency: req.query.getCurrency || undefined,
        payCurrency: req.query.payCurrency || undefined,
        from:        req.query.from        || undefined,
        to:          req.query.to          || undefined,
        limit:       req.query.limit       || undefined,
        cursor:      req.query.cursor      || undefined,
      });

      const nextCursor = hasMore ? rows[rows.length - 1].id : null;

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

  router.get('/ohlcv', async (req, res) => {
    const { pairKey, bucketSeconds, limit } = req.query;
    if (!pairKey) {
      return res.status(400).json({ error: 'pairKey query parameter is required' });
    }

    let parsed;
    try {
      parsed = parsePairKey(pairKey);
    } catch {
      return res.status(400).json({ error: 'Invalid pairKey format' });
    }

    const bs = bucketSeconds ? parseInt(bucketSeconds, 10) : undefined;
    const lim = limit ? parseInt(limit, 10) : undefined;

    if (bs !== undefined && (!Number.isFinite(bs) || bs < 1)) {
      return res.status(400).json({ error: 'bucketSeconds must be a positive integer' });
    }
    if (lim !== undefined && (!Number.isFinite(lim) || lim < 1 || lim > 1000)) {
      return res.status(400).json({ error: 'limit must be between 1 and 1000' });
    }

    try {
      const rows = await getOhlcv(pool, { ...parsed, bucketSeconds: bs, limit: lim });
      res.json({ pairKey, bucketSeconds: bs ?? 30, candles: rows });
    } catch (err) {
      console.error('[FILLS/OHLCV] Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createFillsRouter };
