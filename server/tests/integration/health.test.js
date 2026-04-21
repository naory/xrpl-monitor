/**
 * Integration tests for GET /health endpoint.
 * Requires Postgres and Redis (via docker-compose).
 * Skips gracefully if either is unavailable.
 */
const request = require('supertest');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { createApp } = require('../../src/api/app');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5434', 10),
  user: process.env.PGUSER || 'xrpl',
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

let dbAvailable = false;
let redisAvailable = false;

beforeAll(async () => {
  try { await pool.query('SELECT 1'); dbAvailable = true; } catch {}
  try { await redis.connect(); redisAvailable = true; } catch {}

  if (!dbAvailable) console.warn('[INTEGRATION] Postgres unavailable');
  if (!redisAvailable) console.warn('[INTEGRATION] Redis unavailable');
});

afterAll(async () => {
  await pool.end();
  await redis.quit().catch(() => {});
});

describe('GET /health', () => {
  it('returns 200 and ok status when all dependencies are healthy', async () => {
    if (!dbAvailable || !redisAvailable) return;

    const state = { xrplConnected: true, lastLedgerIndex: 90000005, lastKnownLedger: 90000000, currentLedger: 90000005 };
    const app = createApp({ pool, redis, state });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.status).toBe('ok');
    expect(res.body.checks.redis.status).toBe('ok');
    expect(res.body.checks.xrpl.status).toBe('ok');
  });

  it('returns 503 and degraded when XRPL is disconnected', async () => {
    if (!dbAvailable || !redisAvailable) return;

    const state = { xrplConnected: false, lastLedgerIndex: null, lastKnownLedger: null, currentLedger: null };
    const app = createApp({ pool, redis, state });

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.xrpl.status).toBe('error');
  });

  it('includes ledger gap info in the report', async () => {
    if (!dbAvailable || !redisAvailable) return;

    const state = { xrplConnected: true, lastLedgerIndex: 89999900, lastKnownLedger: 89999900, currentLedger: 90000005 };
    const app = createApp({ pool, redis, state });

    const res = await request(app).get('/health');
    expect(res.body.checks.ledgerGap.hasGap).toBe(true);
    expect(res.body.checks.ledgerGap.gapSize).toBe(105);
  });
});
