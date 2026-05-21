/**
 * Integration tests for xrp_demand_hourly DB writer.
 * Requires a running Postgres instance (via docker-compose).
 * Skips gracefully if DB is unavailable.
 * Run: cd server && PGPORT=5434 npx jest tests/integration/xrpDemandBuckets.test.js
 */
const { Pool } = require('pg');
const { upsertXrpDemandBuckets, queryXrpDemandBuckets } = require('../../src/db/xrpDemandBuckets');

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5434', 10),
  user:     process.env.PGUSER     || 'xrpl',
  password: process.env.PGPASSWORD || 'xrplpass',
  database: process.env.PGDATABASE || 'xrpl_monitor',
  connectionTimeoutMillis: 3000,
});

let dbAvailable = false;

beforeAll(async () => {
  try {
    await pool.query('SELECT 1');
    await pool.query('TRUNCATE TABLE xrp_demand_hourly');
    dbAvailable = true;
  } catch {
    console.warn('[INTEGRATION] Postgres unavailable — skipping xrpDemandBuckets tests');
  }
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  if (dbAvailable) await pool.query('TRUNCATE TABLE xrp_demand_hourly');
});

const HOUR      = new Date('2026-05-20T14:00:00Z');
const NEXT_HOUR = new Date('2026-05-20T15:00:00Z');

function makeRow(overrides = {}) {
  return { hour: HOUR, currency: 'USD', xrpBought: 100, xrpSold: 200, eventCount: 3, ...overrides };
}

describe('upsertXrpDemandBuckets', () => {
  it('inserts a new bucket row', async () => {
    if (!dbAvailable) return;
    await upsertXrpDemandBuckets(pool, [makeRow()]);
    const { rows } = await pool.query('SELECT * FROM xrp_demand_hourly');
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe('USD');
    expect(parseFloat(rows[0].xrp_bought)).toBeCloseTo(100);
    expect(parseFloat(rows[0].xrp_sold)).toBeCloseTo(200);
    expect(rows[0].event_count).toBe(3);
  });

  it('accumulates volumes on conflict (same bucket, second upsert)', async () => {
    if (!dbAvailable) return;
    await upsertXrpDemandBuckets(pool, [makeRow()]);
    await upsertXrpDemandBuckets(pool, [makeRow()]);
    const { rows } = await pool.query('SELECT * FROM xrp_demand_hourly');
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].xrp_bought)).toBeCloseTo(200);
    expect(parseFloat(rows[0].xrp_sold)).toBeCloseTo(400);
    expect(rows[0].event_count).toBe(6);
  });

  it('inserts multiple rows (different currencies) in one call', async () => {
    if (!dbAvailable) return;
    await upsertXrpDemandBuckets(pool, [
      makeRow({ currency: 'USD' }),
      makeRow({ currency: 'EUR', xrpBought: 50, xrpSold: 75 }),
    ]);
    const { rows } = await pool.query('SELECT * FROM xrp_demand_hourly ORDER BY currency');
    expect(rows).toHaveLength(2);
    expect(rows[0].currency).toBe('EUR');
    expect(rows[1].currency).toBe('USD');
  });

  it('is a no-op for an empty array', async () => {
    if (!dbAvailable) return;
    await expect(upsertXrpDemandBuckets(pool, [])).resolves.not.toThrow();
    const { rows } = await pool.query('SELECT * FROM xrp_demand_hourly');
    expect(rows).toHaveLength(0);
  });
});

describe('queryXrpDemandBuckets', () => {
  it('returns rows within the requested range', async () => {
    if (!dbAvailable) return;
    await upsertXrpDemandBuckets(pool, [
      makeRow({ hour: HOUR }),
      makeRow({ hour: NEXT_HOUR, currency: 'EUR' }),
    ]);
    const rows = await queryXrpDemandBuckets(pool, { from: HOUR, to: NEXT_HOUR });
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe('USD');
  });

  it('returns rows in ascending hour order', async () => {
    if (!dbAvailable) return;
    await upsertXrpDemandBuckets(pool, [
      makeRow({ hour: NEXT_HOUR }),
      makeRow({ hour: HOUR }),
    ]);
    const rows = await queryXrpDemandBuckets(pool, {
      from: HOUR, to: new Date('2026-05-20T16:00:00Z'),
    });
    expect(new Date(rows[0].hour).getTime()).toBeLessThan(new Date(rows[1].hour).getTime());
  });

  it('returns camelCase column aliases', async () => {
    if (!dbAvailable) return;
    await upsertXrpDemandBuckets(pool, [makeRow()]);
    const rows = await queryXrpDemandBuckets(pool, {
      from: HOUR, to: new Date('2026-05-20T16:00:00Z'),
    });
    expect(rows[0]).toHaveProperty('currency');
    expect(rows[0]).toHaveProperty('xrpBought');
    expect(rows[0]).toHaveProperty('xrpSold');
    expect(rows[0]).toHaveProperty('eventCount');
  });

  it('returns empty array when no rows in range', async () => {
    if (!dbAvailable) return;
    const rows = await queryXrpDemandBuckets(pool, { from: HOUR, to: NEXT_HOUR });
    expect(rows).toEqual([]);
  });
});
