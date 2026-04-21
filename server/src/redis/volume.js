const WINDOWS = {
  '10m': 10 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

const LOG_KEY  = (w) => `vol:log:${w}`;
const RANK_KEY = (w) => `vol:rank:${w}`;

function computeCutoff(windowName, now = Date.now()) {
  const size = WINDOWS[windowName];
  if (size === undefined) throw new Error(`Unknown volume window: ${windowName}`);
  return now - size;
}

function encodeVolumeEvent(pairKey, volume, txHash, account, timestamp = Date.now()) {
  return JSON.stringify({ p: pairKey, v: volume, tx: txHash, a: account, t: timestamp });
}

function decodeVolumeEvent(str) {
  try {
    if (!str) return null;
    const { p, v, t } = JSON.parse(str);
    if (!p || !v || t === undefined) return null;
    return { pairKey: p, volume: v, timestamp: t };
  } catch {
    return null;
  }
}

function detectTopKChange(previous, current) {
  if (!previous) return true;
  if (previous.length !== current.length) return true;
  return previous.some((p, i) => p.pairKey !== current[i]?.pairKey);
}

function xrpSideVolume(fill) {
  // Always accumulate the XRP side so leaderboard volumes are in XRP.
  // For token/token pairs fall back to getsValue.
  if (fill.getsCurrency === 'XRP') return { raw: fill.getsValue, parsed: parseFloat(fill.getsValue) || 0 };
  if (fill.paysCurrency === 'XRP') return { raw: fill.paysValue, parsed: parseFloat(fill.paysValue) || 0 };
  return { raw: fill.getsValue, parsed: parseFloat(fill.getsValue) || 0 };
}

async function recordVolume(redis, fills, now = Date.now()) {
  if (!fills.length) return;
  const pipeline = redis.pipeline();
  for (const window of Object.keys(WINDOWS)) {
    for (const fill of fills) {
      const { raw, parsed: volume } = xrpSideVolume(fill);
      if (volume <= 0) continue;
      const event = encodeVolumeEvent(fill.pairKey, raw, fill.txHash, fill.account, now);
      pipeline.zadd(LOG_KEY(window), now, event);
      pipeline.zadd(RANK_KEY(window), 'INCR', volume, fill.pairKey);
    }
  }
  await pipeline.exec();
}

async function trimWindows(redis, now = Date.now()) {
  for (const window of Object.keys(WINDOWS)) {
    const cutoff = computeCutoff(window, now);
    const expired = await redis.zrangebyscore(LOG_KEY(window), '-inf', cutoff);
    if (!expired.length) continue;

    const pipeline = redis.pipeline();
    for (const raw of expired) {
      const ev = decodeVolumeEvent(raw);
      if (ev) {
        const volume = parseFloat(ev.volume) || 0;
        if (volume > 0) pipeline.zadd(RANK_KEY(window), 'INCR', -volume, ev.pairKey);
      }
    }
    pipeline.zremrangebyscore(LOG_KEY(window), '-inf', cutoff);
    // Clean up pairs whose cumulative volume has dropped to zero or below
    pipeline.zremrangebyscore(RANK_KEY(window), '-inf', 0);
    await pipeline.exec();
  }
}

async function getVolumeLeaderboard(redis, windowName, k = 20) {
  if (!WINDOWS[windowName]) throw new Error(`Unknown volume window: ${windowName}`);
  const results = await redis.zrevrange(RANK_KEY(windowName), 0, k - 1, 'WITHSCORES');
  const pairs = [];
  for (let i = 0; i < results.length; i += 2) {
    pairs.push({ pairKey: results[i], volume: parseFloat(results[i + 1]) });
  }
  return pairs;
}

module.exports = {
  WINDOWS,
  LOG_KEY,
  RANK_KEY,
  computeCutoff,
  encodeVolumeEvent,
  decodeVolumeEvent,
  detectTopKChange,
  recordVolume,
  trimWindows,
  getVolumeLeaderboard,
};
