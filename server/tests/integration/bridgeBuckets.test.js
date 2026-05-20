/**
 * Integration tests for bridge_hourly_buckets DB writer.
 * Requires a running Postgres instance (via docker-compose).
 * Skips gracefully if DB is unavailable.
 * Run: cd server && PGPORT=5434 npx jest tests/integration/bridgeBuckets.test.js
 */
const { Pool } = require('pg');
const { upsertBridgeBuckets, queryBridgeBuckets } = require('../../src/db/bridgeBuckets');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5434', 10),
  user: process.env.PGUSER || 'xrpl',
  password: process.env.PGPASSWORD || 'xrplpass',
  database: process.env.PGDATABASE || 'xrpl_monitor',
  connectionTimeoutMillis: 3000,
});

let dbAvailable = false;

beforeAll(async () => {
  try {
    await pool.query('SELECT 1');
    await pool.query('TRUNCATE TABLE bridge_hourly_buckets');
    dbAvailable = true;
  } catch {
    console.warn('[INTEGRATION] Postgres unavailable — skipping bridgeBuckets tests');
  }
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  if (dbAvailable) await pool.query('TRUNCATE TABLE bridge_hourly_buckets');
});

const HOUR = new Date('2026-05-20T14:00:00Z');
const NEXT_HOUR = new Date('2026-05-20T15:00:00Z');

function makeRow(overrides = {}) {
  return {
    hour:         HOUR,
    fromCurrency: 'USD',
    fromIssuer:   'rIssuer1',
    toCurrency:   'EUR',
    toIssuer:     'rIssuer2',
    fromVolume:   100,
    toVolume:     92,
    xrpVolume:    205,
    eventCount:   3,
    ...overrides,
  };
}

describe('upsertBridgeBuckets', () => {
  it('inserts a new bucket row', async () => {
    if (!dbAvailable) return test.skip();

    await upsertBridgeBuckets(pool, [makeRow()]);

    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets');
    expect(rows).toHaveLength(1);
    expect(rows[0].from_currency).toBe('USD');
    expect(parseFloat(rows[0].xrp_volume)).toBeCloseTo(205);
    expect(rows[0].event_count).toBe(3);
  });

  it('accumulates volumes on conflict (same bucket, second upsert)', async () => {
    if (!dbAvailable) return test.skip();

    await upsertBridgeBuckets(pool, [makeRow()]);
    await upsertBridgeBuckets(pool, [makeRow()]);

    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets');
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].xrp_volume)).toBeCloseTo(410);
    expect(rows[0].event_count).toBe(6);
  });

  it('inserts multiple rows in one call', async () => {
    if (!dbAvailable) return test.skip();

    await upsertBridgeBuckets(pool, [
      makeRow({ fromCurrency: 'USD', toCurrency: 'EUR' }),
      makeRow({ fromCurrency: 'BTC', toCurrency: 'USD', fromIssuer: '', toIssuer: 'rIssuer1' }),
    ]);

    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets ORDER BY from_currency');
    expect(rows).toHaveLength(2);
    expect(rows[0].from_currency).toBe('BTC');
    expect(rows[1].from_currency).toBe('USD');
  });

  it('is a no-op for an empty array', async () => {
    if (!dbAvailable) return test.skip();
    await expect(upsertBridgeBuckets(pool, [])).resolves.not.toThrow();
    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets');
    expect(rows).toHaveLength(0);
  });

  it('handles XRP issuers stored as empty string', async () => {
    if (!dbAvailable) return test.skip();

    await upsertBridgeBuckets(pool, [makeRow({ fromIssuer: '', toIssuer: '' })]);
    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets');
    expect(rows[0].from_issuer).toBe('');
    expect(rows[0].to_issuer).toBe('');
  });
});

describe('queryBridgeBuckets', () => {
  it('returns rows within the requested range', async () => {
    if (!dbAvailable) return test.skip();

    await upsertBridgeBuckets(pool, [
      makeRow({ hour: HOUR }),
      makeRow({ hour: NEXT_HOUR, fromCurrency: 'BTC', fromIssuer: '' }),
    ]);

    const rows = await queryBridgeBuckets(pool, { from: HOUR, to: NEXT_HOUR });
    expect(rows).toHaveLength(1);
    expect(rows[0].fromCurrency).toBe('USD');
  });

  it('returns rows in ascending hour order', async () => {
    if (!dbAvailable) return test.skip();

    await upsertBridgeBuckets(pool, [
      makeRow({ hour: NEXT_HOUR }),
      makeRow({ hour: HOUR }),
    ]);

    const rows = await queryBridgeBuckets(pool, {
      from: HOUR,
      to: new Date('2026-05-20T16:00:00Z'),
    });
    expect(new Date(rows[0].hour).getTime()).toBeLessThan(new Date(rows[1].hour).getTime());
  });

  it('returns camelCase column aliases', async () => {
    if (!dbAvailable) return test.skip();

    await upsertBridgeBuckets(pool, [makeRow()]);
    const rows = await queryBridgeBuckets(pool, {
      from: HOUR,
      to: new Date('2026-05-20T16:00:00Z'),
    });
    expect(rows[0]).toHaveProperty('fromCurrency');
    expect(rows[0]).toHaveProperty('fromIssuer');
    expect(rows[0]).toHaveProperty('xrpVolume');
    expect(rows[0]).toHaveProperty('eventCount');
  });

  it('returns empty array when no rows in range', async () => {
    if (!dbAvailable) return test.skip();
    const rows = await queryBridgeBuckets(pool, { from: HOUR, to: NEXT_HOUR });
    expect(rows).toEqual([]);
  });
});
