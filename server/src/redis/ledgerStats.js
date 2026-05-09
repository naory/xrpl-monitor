const WINDOWS  = { '10m': 600, '1h': 3600, '24h': 86400 };
const RING_KEY = 'lstats:ring';
const RING_SIZE = 150; // ~10 min of ledgers for sparklines
const LOG_KEY  = (w) => `lstats:log:${w}`;

async function pushLedgerRecord(redis, record) {
  const score = Math.floor(record.closedAt / 1000);
  const json  = JSON.stringify(record);

  const pipeline = redis.pipeline();
  pipeline.lpush(RING_KEY, json);
  pipeline.ltrim(RING_KEY, 0, RING_SIZE - 1);
  for (const w of Object.keys(WINDOWS)) {
    pipeline.zadd(LOG_KEY(w), score, json);
  }
  await pipeline.exec();
}

async function trimLedgerStats(redis) {
  const now = Math.floor(Date.now() / 1000);
  const pipeline = redis.pipeline();
  for (const [w, secs] of Object.entries(WINDOWS)) {
    pipeline.zremrangebyscore(LOG_KEY(w), '-inf', now - secs);
  }
  await pipeline.exec();
}

async function getLedgerRecords(redis, window) {
  if (!WINDOWS[window]) throw new Error(`Unknown window: ${window}`);
  const secs = WINDOWS[window];
  const now  = Math.floor(Date.now() / 1000);
  const items = await redis.zrangebyscore(LOG_KEY(window), now - secs, '+inf');
  return items.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

async function getLedgerRing(redis, count = RING_SIZE) {
  const items = await redis.lrange(RING_KEY, 0, count - 1);
  return items
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter(Boolean)
    .reverse(); // oldest-first for time series charts
}

function aggregateLedgers(ledgers) {
  if (!ledgers.length) return null;
  const out = {
    ledgerCount: ledgers.length,
    txnCount: 0, successCount: 0, failedCount: 0,
    feeBurnDrops: 0, paymentXrpDrops: 0,
    txTypes: {}, closeTimes: [],
  };
  for (const l of ledgers) {
    out.txnCount        += l.txnCount        || 0;
    out.successCount    += l.successCount    || 0;
    out.failedCount     += l.failedCount     || 0;
    out.feeBurnDrops    += l.feeBurnDrops    || 0;
    out.paymentXrpDrops += l.paymentXrpDrops || 0;
    if (l.closeTimeSec != null) out.closeTimes.push(l.closeTimeSec);
    for (const [type, cnt] of Object.entries(l.txTypes || {})) {
      out.txTypes[type] = (out.txTypes[type] || 0) + cnt;
    }
  }
  const sorted = [...ledgers].sort((a, b) => a.closedAt - b.closedAt);
  const span   = sorted.length > 1
    ? (sorted[sorted.length - 1].closedAt - sorted[0].closedAt) / 1000
    : 1;
  out.tps             = span > 0 ? out.txnCount / span : 0;
  out.avgCloseTimeSec = out.closeTimes.length
    ? out.closeTimes.reduce((a, b) => a + b, 0) / out.closeTimes.length
    : null;
  out.successRate     = out.txnCount > 0 ? out.successCount / out.txnCount : null;
  out.feeBurnXrp      = out.feeBurnDrops / 1e6;
  out.paymentXrp      = out.paymentXrpDrops / 1e6;
  return out;
}

module.exports = { WINDOWS, pushLedgerRecord, trimLedgerStats, getLedgerRecords, getLedgerRing, aggregateLedgers };
