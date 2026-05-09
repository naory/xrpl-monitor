const WINDOWS = { '10m': 10 * 60 * 1000, '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000 };

const VOL_LOG  = (w) => `amm:vol:log:${w}`;
const VOL_RANK = (w) => `amm:vol:rank:${w}`;
const POOL_KEY = (ammAccount) => `amm:pool:${ammAccount}`;
const POOLS_INDEX = 'amm:pools'; // SET of known ammAccounts

// ── Pool registry ────────────────────────────────────────────────────────────

async function upsertPool(redis, { ammAccount, pairKey, asset1, asset2, fee, xrpTvl, tokenTvl }) {
  const data = JSON.stringify({ ammAccount, pairKey, asset1, asset2, fee, xrpTvl, tokenTvl, updatedAt: Date.now() });
  await redis.set(POOL_KEY(ammAccount), data);
  await redis.sadd(POOLS_INDEX, ammAccount);
}

async function getPool(redis, ammAccount) {
  const raw = await redis.get(POOL_KEY(ammAccount));
  return raw ? JSON.parse(raw) : null;
}

async function getAllPools(redis) {
  const accounts = await redis.smembers(POOLS_INDEX);
  if (!accounts.length) return [];
  const pipeline = redis.pipeline();
  accounts.forEach((a) => pipeline.get(POOL_KEY(a)));
  const results = await pipeline.exec();
  return results
    .map(([, raw]) => raw ? JSON.parse(raw) : null)
    .filter(Boolean);
}

// ── Swap volume tracking (same pattern as IOU volume.js) ─────────────────────

async function recordAmmVolume(redis, events, now = Date.now()) {
  const swaps = events.filter((e) => e.type === 'swap' && e.xrpVolume > 0);
  if (!swaps.length) return;

  const pipeline = redis.pipeline();
  for (const window of Object.keys(WINDOWS)) {
    for (const ev of swaps) {
      const entry = JSON.stringify({ a: ev.ammAccount, v: ev.xrpVolume, t: now });
      pipeline.zadd(VOL_LOG(window), now, entry);
      pipeline.zadd(VOL_RANK(window), 'INCR', ev.xrpVolume, ev.ammAccount);
    }
  }
  await pipeline.exec();
}

async function trimAmmWindows(redis, now = Date.now()) {
  for (const [window, ms] of Object.entries(WINDOWS)) {
    const cutoff = now - ms;
    const expired = await redis.zrangebyscore(VOL_LOG(window), '-inf', cutoff);
    if (!expired.length) continue;

    const pipeline = redis.pipeline();
    for (const raw of expired) {
      try {
        const { v } = JSON.parse(raw);
        pipeline.zadd(VOL_RANK(window), 'INCR', -v, JSON.parse(raw).a);
      } catch {}
    }
    pipeline.zremrangebyscore(VOL_LOG(window), '-inf', cutoff);
    pipeline.zremrangebyscore(VOL_RANK(window), '-inf', 0);
    await pipeline.exec();
  }
}

async function getAmmVolumeLeaderboard(redis, windowName, k = 20) {
  if (!WINDOWS[windowName]) throw new Error(`Unknown window: ${windowName}`);
  const results = await redis.zrevrange(VOL_RANK(windowName), 0, k - 1, 'WITHSCORES');
  const out = [];
  for (let i = 0; i < results.length; i += 2) {
    out.push({ ammAccount: results[i], volume: parseFloat(results[i + 1]) });
  }
  return out;
}

module.exports = {
  WINDOWS,
  upsertPool, getPool, getAllPools,
  recordAmmVolume, trimAmmWindows, getAmmVolumeLeaderboard,
};
