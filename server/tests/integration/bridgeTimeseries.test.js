/**
 * Requires Redis (docker-compose). Skips gracefully when unavailable.
 * Run: REDIS_PORT=6380 npx jest tests/integration/bridgeTimeseries.test.js
 */
const Redis = require('ioredis');
const { LOG_KEY, recordBridgeEvent, getBridgeEvents, trimBridgeEvents } = require('../../src/redis/bridgeTimeseries');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  lazyConnect: true,
  connectTimeout: 3000,
});

let available = false;

beforeAll(async () => {
  try { await redis.connect(); available = true; }
  catch { console.warn('[INTEGRATION] Redis unavailable — skipping bridgeTimeseries tests'); }
});

afterAll(async () => { await redis.quit().catch(() => {}); });

beforeEach(async () => {
  if (available) await redis.del(LOG_KEY);
});

function makeBridge(overrides = {}) {
  return {
    txHash:       'TXHASH001',
    ledgerTime:   new Date('2026-05-10T10:00:00Z'),
    fromCurrency: 'USD',
    fromIssuer:   'rIssuer1',
    fromValue:    '100',
    toCurrency:   'EUR',
    toIssuer:     'rIssuer2',
    toValue:      '92',
    xrpValue:     '205',
    ...overrides,
  };
}

describe('recordBridgeEvent', () => {
  it('stores a bridge event in the sorted set', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge(), now);
    const count = await redis.zcard(LOG_KEY);
    expect(count).toBe(1);
  });

  it('stores multiple distinct events', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge({ txHash: 'TX001' }), now);
    await recordBridgeEvent(redis, makeBridge({ txHash: 'TX002' }), now + 1);
    expect(await redis.zcard(LOG_KEY)).toBe(2);
  });

  it('converts Date ledgerTime to ISO string', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge({ ledgerTime: new Date('2026-05-10T10:00:00Z') }), now);
    const [raw] = await redis.zrange(LOG_KEY, 0, 0);
    const parsed = JSON.parse(raw);
    expect(parsed.ledgerTime).toBe('2026-05-10T10:00:00.000Z');
  });
});

describe('getBridgeEvents', () => {
  it('returns events within the window', async () => {
    if (!available) return;
    const now = Date.now();
    const recent = now - 5 * 60 * 1000; // 5 minutes ago — inside 10m
    const old    = now - 20 * 60 * 1000; // 20 minutes ago — outside 10m, inside 1h
    await recordBridgeEvent(redis, makeBridge({ txHash: 'RECENT' }), recent);
    await recordBridgeEvent(redis, makeBridge({ txHash: 'OLD'    }), old);

    const events10m = await getBridgeEvents(redis, '10m', now);
    expect(events10m).toHaveLength(1);
    expect(events10m[0].txHash).toBe('RECENT');

    const events1h = await getBridgeEvents(redis, '1h', now);
    expect(events1h).toHaveLength(2);
  });

  it('returns events oldest-first (sorted by score)', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge({ txHash: 'NEWER' }), now);
    await recordBridgeEvent(redis, makeBridge({ txHash: 'OLDER' }), now - 1000);
    const events = await getBridgeEvents(redis, '1h', now);
    expect(events[0].txHash).toBe('OLDER');
    expect(events[1].txHash).toBe('NEWER');
  });

  it('throws for unknown window', async () => {
    if (!available) return;
    await expect(getBridgeEvents(redis, '7d')).rejects.toThrow('Unknown window');
  });

  it('returns empty array when no events in window', async () => {
    if (!available) return;
    const events = await getBridgeEvents(redis, '10m');
    expect(events).toEqual([]);
  });
});

describe('trimBridgeEvents', () => {
  it('removes events older than 24h', async () => {
    if (!available) return;
    const now = Date.now();
    const old = now - 25 * 60 * 60 * 1000; // 25h ago
    await recordBridgeEvent(redis, makeBridge({ txHash: 'OLD'    }), old);
    await recordBridgeEvent(redis, makeBridge({ txHash: 'RECENT' }), now);
    await trimBridgeEvents(redis, now);
    const events = await getBridgeEvents(redis, '24h', now);
    expect(events).toHaveLength(1);
    expect(events[0].txHash).toBe('RECENT');
  });

  it('is a no-op when all events are within 24h', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge(), now - 60_000);
    await trimBridgeEvents(redis, now);
    expect(await redis.zcard(LOG_KEY)).toBe(1);
  });
});
