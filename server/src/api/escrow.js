const { Router } = require('express');
const { queryEscrowBuckets } = require('../db/escrowBuckets');

const MAX_RANGE_MS = 48 * 60 * 60 * 1000;

function validateRange(req, res) {
  const { from, to } = req.query;
  if (!from || !to) {
    res.status(400).json({ error: 'Both "from" and "to" query params are required (ISO 8601)' });
    return null;
  }
  const fromDate = new Date(from);
  const toDate   = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate >= toDate) {
    res.status(400).json({ error: '"from" and "to" must be valid ISO 8601 timestamps with from < to' });
    return null;
  }
  if (toDate - fromDate > MAX_RANGE_MS) {
    res.status(400).json({ error: 'Range cannot exceed 48 hours' });
    return null;
  }
  return { fromDate, toDate };
}

function createEscrowRouter({ pool }) {
  const router = Router();

  async function handleBuckets(type, req, res) {
    const range = validateRange(req, res);
    if (!range) return;
    const { fromDate, toDate } = range;
    try {
      const buckets = await queryEscrowBuckets(pool, { from: fromDate, to: toDate, type });
      res.json({ from: req.query.from, to: req.query.to, buckets });
    } catch (err) {
      console.error(`[ESCROW/${type}] Error:`, err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  router.get('/time-lock/buckets', (req, res) => handleBuckets('time_lock', req, res));
  router.get('/ilp/buckets',       (req, res) => handleBuckets('ilp',       req, res));

  return router;
}

module.exports = { createEscrowRouter };
