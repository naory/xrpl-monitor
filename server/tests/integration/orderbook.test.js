/**
 * Integration tests for Redis order book cache.
 * Requires a running Redis Stack instance (via docker-compose).
 * Skips gracefully if Redis is unavailable.
 */
const Redis = require('ioredis');
const { setOrderBook, getOrderBook, deleteOrderBook } = require('../../src/redis/orderbook');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  lazyConnect: true,
  connectTimeout: 3000,
});

let available = false;

beforeAll(async () => {
  try {
    await redis.connect();
    available = true;
  } catch {
    console.warn('[INTEGRATION] Redis unavailable — skipping orderbook tests');
  }
});

afterAll(async () => {
  await redis.quit().catch(() => {});
});

const PAIR_KEY = 'XRP|~USD|rIssuer1';
const snapshot = {
  bids: [{ Account: 'rMaker1', TakerGets: '1000000', TakerPays: { currency: 'USD', issuer: 'rIssuer1', value: '1' } }],
  asks: [],
  ledgerIndex: 90000001,
};

describe('setOrderBook / getOrderBook', () => {
  beforeEach(async () => {
    if (available) await redis.del(`book:${PAIR_KEY}`);
  });

  it('stores and retrieves an order book snapshot', async () => {
    if (!available) return;
    await setOrderBook(redis, PAIR_KEY, snapshot);
    const result = await getOrderBook(redis, PAIR_KEY);
    expect(result).not.toBeNull();
    expect(result.ledgerIndex).toBe(90000001);
    expect(result.bids).toHaveLength(1);
    expect(result.asks).toHaveLength(0);
    expect(result.cachedAt).toBeDefined();
  });

  it('returns null for an unknown pair key', async () => {
    if (!available) return;
    const result = await getOrderBook(redis, 'unknown~pair');
    expect(result).toBeNull();
  });

  it('overwrites the cache on subsequent writes', async () => {
    if (!available) return;
    await setOrderBook(redis, PAIR_KEY, snapshot);
    await setOrderBook(redis, PAIR_KEY, { ...snapshot, ledgerIndex: 90000099 });
    const result = await getOrderBook(redis, PAIR_KEY);
    expect(result.ledgerIndex).toBe(90000099);
  });
});

describe('deleteOrderBook', () => {
  it('removes the cached entry', async () => {
    if (!available) return;
    await setOrderBook(redis, PAIR_KEY, snapshot);
    await deleteOrderBook(redis, PAIR_KEY);
    expect(await getOrderBook(redis, PAIR_KEY)).toBeNull();
  });
});
