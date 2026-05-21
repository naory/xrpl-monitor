const { Router } = require('express');
const { queryXrpDemandBuckets } = require('../db/xrpDemandBuckets');

function createXrpDemandRouter({ pool }) {
  const router = Router();

  router.get('/buckets', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'Both "from" and "to" query params are required (ISO 8601)' });
    }
    const fromDate = new Date(from);
    const toDate   = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate >= toDate) {
      return res.status(400).json({ error: '"from" and "to" must be valid ISO 8601 timestamps with from < to' });
    }
    if (toDate - fromDate > 48 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Range cannot exceed 48 hours' });
    }
    try {
      const buckets = await queryXrpDemandBuckets(pool, { from: fromDate, to: toDate });
      res.json({ from, to, buckets });
    } catch (err) {
      console.error('[XRP_DEMAND/BUCKETS] Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createXrpDemandRouter };
