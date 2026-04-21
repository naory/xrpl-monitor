const GAP_THRESHOLD = 10;

function detectGap({ lastKnownLedger, currentLedger, threshold = GAP_THRESHOLD }) {
  if (lastKnownLedger === null || lastKnownLedger === undefined) {
    return { hasGap: false, gapSize: 0 };
  }
  const gapSize = currentLedger - lastKnownLedger;
  return { hasGap: gapSize > threshold, gapSize };
}

function buildHealthReport({ xrplConnected, lastLedgerIndex, lastKnownLedger, currentLedger, dbOk, redisOk, uptimeSeconds }) {
  const gap = detectGap({ lastKnownLedger, currentLedger });

  const checks = {
    xrpl: xrplConnected
      ? { status: 'ok', lastLedgerIndex }
      : { status: 'error', message: 'XRPL WebSocket disconnected' },
    database: dbOk
      ? { status: 'ok' }
      : { status: 'error', message: 'Database unreachable' },
    redis: redisOk
      ? { status: 'ok' }
      : { status: 'error', message: 'Redis unreachable' },
    ledgerGap: gap,
  };

  const degraded = !xrplConnected || !dbOk || !redisOk;

  return {
    status: degraded ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    checks,
  };
}

function createHealthRouter({ state, pool, redis }) {
  const express = require('express');
  const router = express.Router();

  router.get('/', async (req, res) => {
    let dbOk = false;
    let redisOk = false;

    try {
      await pool.query('SELECT 1');
      dbOk = true;
    } catch (_) {}

    try {
      await redis.ping();
      redisOk = true;
    } catch (_) {}

    const report = buildHealthReport({
      xrplConnected: state.xrplConnected,
      lastLedgerIndex: state.lastLedgerIndex,
      lastKnownLedger: state.lastKnownLedger,
      currentLedger: state.currentLedger,
      dbOk,
      redisOk,
      uptimeSeconds: Math.floor(process.uptime()),
    });

    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  return router;
}

module.exports = { detectGap, buildHealthReport, createHealthRouter };
