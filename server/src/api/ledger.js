const { Router } = require('express');
const { getLedgerRecords, getLedgerRing, aggregateLedgers, WINDOWS } = require('../redis/ledgerStats');

function createLedgerRouter({ redis }) {
  const router = Router();

  router.get('/stats', async (req, res) => {
    const { window = '1h' } = req.query;
    if (!WINDOWS[window]) {
      return res.status(400).json({ error: `Unknown window. Valid: ${Object.keys(WINDOWS).join(', ')}` });
    }
    try {
      const [records, ring] = await Promise.all([
        getLedgerRecords(redis, window),
        getLedgerRing(redis, 150),
      ]);
      const summary = aggregateLedgers(records);
      res.json({ window, summary, series: ring });
    } catch (err) {
      console.error('[LEDGER/STATS] Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createLedgerRouter };
