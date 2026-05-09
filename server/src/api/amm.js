const { Router } = require('express');
const { getAmmVolumeLeaderboard, getAllPools, WINDOWS } = require('../redis/ammVolume');

function createAmmRouter({ redis }) {
  const router = Router();

  router.get('/stats', async (req, res) => {
    const { window = '1h' } = req.query;
    if (!WINDOWS[window]) {
      return res.status(400).json({ error: `Unknown window. Valid: ${Object.keys(WINDOWS).join(', ')}` });
    }

    try {
      const [leaderboard, pools] = await Promise.all([
        getAmmVolumeLeaderboard(redis, window),
        getAllPools(redis),
      ]);

      // Join volume rank with pool metadata.
      const poolMap = Object.fromEntries(pools.map((p) => [p.ammAccount, p]));
      const ranked = leaderboard
        .map(({ ammAccount, volume }) => ({
          ...(poolMap[ammAccount] ?? { ammAccount }),
          volume,
        }))
        .filter((p) => p.pairKey); // skip pools we have no metadata for yet

      // Also include pools with metadata but no recent volume (volume = 0).
      const rankedAccounts = new Set(ranked.map((p) => p.ammAccount));
      const unranked = pools
        .filter((p) => !rankedAccounts.has(p.ammAccount))
        .map((p) => ({ ...p, volume: 0 }));

      res.json({ window, pools: [...ranked, ...unranked] });
    } catch (err) {
      console.error('[AMM/STATS] Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createAmmRouter };
