/**
 * Integration tests for GET /book endpoint.
 * Uses mocked xrplClient and pairRegistry to avoid live XRPL dependency.
 * Requires Redis for cache tests.
 */
const request = require('supertest');
const Redis = require('ioredis');
const { createApp } = require('../../src/api/app');
const { setOrderBook } = require('../../src/redis/orderbook');
const { PairRegistry } = require('../../src/ingest/pairRegistry');
const { buildPairKey } = require('../../src/ingest/fillExtractor');
const { Pool } = require('pg');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  lazyConnect: true,
  connectTimeout: 3000,
});

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5434', 10),
  user: process.env.PGUSER || 'xrpl',
  password: process.env.PGPASSWORD || 'xrplpass',
  database: process.env.PGDATABASE || 'xrpl_monitor',
  connectionTimeoutMillis: 3000,
});

let redisAvailable = false;

const mockXrplClient = {
  isConnected: () => true,
  requestOrderBook: jest.fn().mockResolvedValue([{ Account: 'rLive', TakerGets: '1000000' }]),
};

const mockXrplClientDisconnected = {
  isConnected: () => false,
  requestOrderBook: jest.fn(),
};

function makeApp(xrplClient) {
  const pairRegistry = new PairRegistry();
  pairRegistry.register(
    buildPairKey({ currency: 'XRP', issuer: null }, { currency: 'USD', issuer: 'rIssuer1' }),
    { getsCurrency: 'XRP', getsIssuer: null, paysCurrency: 'USD', paysIssuer: 'rIssuer1' },
  );
  const state = { xrplConnected: xrplClient.isConnected(), lastLedgerIndex: null, lastKnownLedger: null, currentLedger: null };
  return createApp({ pool, redis, state, xrplClient, pairRegistry });
}

beforeAll(async () => {
  try { await redis.connect(); redisAvailable = true; } catch {}
  if (!redisAvailable) console.warn('[INTEGRATION] Redis unavailable — skipping book tests');
});

afterAll(async () => {
  await pool.end();
  await redis.quit().catch(() => {});
});

describe('GET /book', () => {
  it('returns 400 when required query params are missing', async () => {
    if (!redisAvailable) return;
    const app = makeApp(mockXrplClient);
    const res = await request(app).get('/book?getsCurrency=XRP');
    expect(res.status).toBe(400);
  });

  it('serves from Redis cache when a snapshot is available', async () => {
    if (!redisAvailable) return;
    const pairKey = buildPairKey({ currency: 'XRP', issuer: null }, { currency: 'USD', issuer: 'rIssuer1' });
    await setOrderBook(redis, pairKey, { bids: [{ id: 1 }], asks: [], ledgerIndex: 90000001 });

    const app = makeApp(mockXrplClient);
    const res = await request(app).get('/book?getsCurrency=XRP&paysCurrency=USD&paysIssuer=rIssuer1');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('cache');
    expect(res.body.bids).toHaveLength(1);
    expect(mockXrplClient.requestOrderBook).not.toHaveBeenCalled();
  });

  it('falls back to live XRPL request on cache miss', async () => {
    if (!redisAvailable) return;
    const pairKey = buildPairKey({ currency: 'XRP', issuer: null }, { currency: 'USD', issuer: 'rIssuer1' });
    await redis.del(`book:${pairKey}`); // ensure no cache

    mockXrplClient.requestOrderBook.mockClear();
    const app = makeApp(mockXrplClient);
    const res = await request(app).get('/book?getsCurrency=XRP&paysCurrency=USD&paysIssuer=rIssuer1');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('live');
    expect(mockXrplClient.requestOrderBook).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when pair is not in registry and cache is empty', async () => {
    if (!redisAvailable) return;
    const app = makeApp(mockXrplClient);
    const res = await request(app).get('/book?getsCurrency=EUR&paysCurrency=JPY&getsIssuer=rUnknown');
    expect(res.status).toBe(404);
  });

  it('returns 503 when XRPL is disconnected and no cache exists', async () => {
    if (!redisAvailable) return;
    const pairKey = buildPairKey({ currency: 'XRP', issuer: null }, { currency: 'USD', issuer: 'rIssuer1' });
    await redis.del(`book:${pairKey}`);

    const app = makeApp(mockXrplClientDisconnected);
    // Need a registry entry so the 404 path is skipped
    const res = await request(app).get('/book?getsCurrency=XRP&paysCurrency=USD&paysIssuer=rIssuer1');
    expect(res.status).toBe(503);
  });
});
