const LOG_KEY = 'bridge:log';

const WINDOWS = {
  '10m': 10 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

const BUCKET_MS = {
  '10m': 30_000,
  '1h':  5 * 60_000,
  '24h': 60 * 60_000,
};

async function recordBridgeEvent(redis, bridge, now = Date.now()) {
  await redis.zadd(LOG_KEY, now, JSON.stringify({
    txHash:       bridge.txHash,
    ledgerTime:   bridge.ledgerTime instanceof Date
                    ? bridge.ledgerTime.toISOString()
                    : bridge.ledgerTime,
    fromCurrency: bridge.fromCurrency,
    fromIssuer:   bridge.fromIssuer ?? null,
    fromValue:    bridge.fromValue,
    toCurrency:   bridge.toCurrency,
    toIssuer:     bridge.toIssuer ?? null,
    toValue:      bridge.toValue,
    xrpValue:     bridge.xrpValue,
  }));
}

async function getBridgeEvents(redis, window, now = Date.now()) {
  if (!WINDOWS[window]) throw new Error(`Unknown window: ${window}`);
  const from = now - WINDOWS[window];
  const items = await redis.zrangebyscore(LOG_KEY, from, '+inf');
  return items
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter(Boolean);
}

async function trimBridgeEvents(redis, now = Date.now()) {
  const cutoff = now - WINDOWS['24h'];
  await redis.zremrangebyscore(LOG_KEY, '-inf', cutoff);
}

module.exports = { LOG_KEY, WINDOWS, BUCKET_MS, recordBridgeEvent, getBridgeEvents, trimBridgeEvents };
