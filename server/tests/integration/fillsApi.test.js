/**
 * Integration tests for GET /fills and GET /fills/stats.
 * Requires Postgres and Redis Stack (docker-compose). Skips gracefully when unavailable.
 */
const request = require('supertest');
const { Pool }  = require('pg');
const Redis     = require('ioredis');
const { createApp } = require('../../src/api/app');

const pool = new Pool({
  host: process.env.PGHOST     || 'localhost',
  port: parseInt(process.env.PGPORT || '5434', 10),
  user: process.env.PGUSER     || 'xrpl',
  password: process.env.PGPASSWORD || 'xrplpass',
  database: process.env.PGDATABASE || 'xrpl_monitor',
  connectionTimeoutMillis: 3000,
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  lazyConnect: true,
  connectTimeout: 3000,
});

let dbAvailable    = false;
let redisAvailable = false;
let app;

const state = { xrplConnected: true, lastLedgerIndex: 100, lastKnownLedger: 100, currentLedger: 100 };

const baseFill = {
  ledger_index:  90000001,
  ledger_time:   '2025-06-01T00:00:00Z',
  tx_hash:       'FILLAPI001',
  account:       'rMakerA',
  gets_currency: 'USD',
  gets_issuer:   'rIssuer1',
  gets_value:    '10',
  pays_currency: 'XRP',
  pays_issuer:   null,
  pays_value:    '50',
};

async function insertFill(overrides = {}) {
  const f = { ...baseFill, ...overrides };
  await pool.query(
    `INSERT INTO trade_fills
       (ledger_index, ledger_time, tx_hash, account,
        gets_currency, gets_issuer, gets_value,
        pays_currency, pays_issuer, pays_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT DO NOTHING`,
    [f.ledger_index, f.ledger_time, f.tx_hash, f.account,
     f.gets_currency, f.gets_issuer, f.gets_value,
     f.pays_currency, f.pays_issuer, f.pays_value],
  );
}

beforeAll(async () => {
  try { await pool.query('SELECT 1'); dbAvailable = true; } catch {}
  try { await redis.connect(); redisAvailable = true; } catch {}

  if (!dbAvailable)    console.warn('[INTEGRATION] Postgres unavailable — skipping fillsApi tests');
  if (!redisAvailable) console.warn('[INTEGRATION] Redis unavailable — skipping fillsApi tests');
  if (!dbAvailable || !redisAvailable) return;

  await pool.query('TRUNCATE TABLE trade_fills RESTART IDENTITY');

  // Seed 10 fills: 5 USD/XRP for rMakerA, 3 EUR/XRP for rMakerB, 2 USD/XRP for rMakerC
  for (let i = 1; i <= 5; i++) {
    await insertFill({ tx_hash: `FILLA${i}`, account: 'rMakerA', gets_currency: 'USD', pays_currency: 'XRP', gets_value: String(i * 10) });
  }
  for (let i = 1; i <= 3; i++) {
    await insertFill({ tx_hash: `FILLB${i}`, account: 'rMakerB', gets_currency: 'EUR', gets_issuer: 'rEurIssuer', pays_currency: 'XRP', gets_value: String(i * 5) });
  }
  for (let i = 1; i <= 2; i++) {
    await insertFill({ tx_hash: `FILLC${i}`, account: 'rMakerC', gets_currency: 'USD', pays_currency: 'XRP', gets_value: String(i * 20) });
  }

  app = createApp({ pool, redis, state, xrplClient: null, pairRegistry: null });
});

afterAll(async () => {
  await pool.end();
  await redis.quit().catch(() => {});
});

describe('GET /fills', () => {
  it('returns 200 with an array of fills and pagination info', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.fills)).toBe(true);
    expect(res.body.fills.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('nextCursor');
  });

  it('returns all 10 seeded fills with a large limit', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.fills).toHaveLength(10);
    expect(res.body.nextCursor).toBeNull();
  });

  it('filters by account', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills?account=rMakerA');
    expect(res.status).toBe(200);
    expect(res.body.fills).toHaveLength(5);
    res.body.fills.forEach((f) => expect(f.account).toBe('rMakerA'));
  });

  it('filters by getCurrency', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills?getCurrency=EUR');
    expect(res.status).toBe(200);
    expect(res.body.fills).toHaveLength(3);
    res.body.fills.forEach((f) => expect(f.gets_currency).toBe('EUR'));
  });

  it('filters by payCurrency', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills?payCurrency=XRP');
    expect(res.status).toBe(200);
    expect(res.body.fills.length).toBe(10);
  });

  it('paginates using cursor', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const first = await request(app).get('/fills?limit=5');
    expect(first.body.fills).toHaveLength(5);
    const cursor = first.body.nextCursor;
    expect(cursor).not.toBeNull();

    const second = await request(app).get(`/fills?limit=5&cursor=${cursor}`);
    expect(second.body.fills).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();

    // No overlap between pages
    const firstIds  = first.body.fills.map((f) => f.id);
    const secondIds = second.body.fills.map((f) => f.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  it('returns results in descending id order', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills?limit=100');
    const ids = res.body.fills.map((f) => f.id);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeLessThan(ids[i - 1]);
    }
  });

  it('returns 400 for a limit above 200', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills?limit=201');
    expect(res.status).toBe(400);
  });
});

describe('GET /fills/stats', () => {
  it('returns 400 when window param is missing', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills/stats');
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown window', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills/stats?window=7d');
    expect(res.status).toBe(400);
  });

  it('returns 200 with volumeLeaderboard array and totalFills count', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills/stats?window=1h');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.volumeLeaderboard)).toBe(true);
    expect(typeof res.body.totalFills).toBe('number');
    expect(res.body.window).toBe('1h');
  });

  it('totalFills reflects the seeded rows', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const res = await request(app).get('/fills/stats?window=24h');
    expect(res.status).toBe(200);
    expect(res.body.totalFills).toBe(10);
  });
});
