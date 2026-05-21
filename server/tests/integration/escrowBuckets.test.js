/**
 * Integration tests for escrow_hourly DB writer.
 * Requires a running Postgres instance (via docker-compose).
 * Skips gracefully if DB is unavailable.
 * Run: cd server && PGPORT=5434 npx jest tests/integration/escrowBuckets.test.js
 */
const { Pool } = require('pg');
const { upsertEscrowBuckets, queryEscrowBuckets } = require('../../src/db/escrowBuckets');

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
    await pool.query('TRUNCATE TABLE escrow_hourly');
    dbAvailable = true;
  } catch {
    console.warn('[INTEGRATION] Postgres unavailable — skipping escrowBuckets tests');
  }
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  if (dbAvailable) await pool.query('TRUNCATE TABLE escrow_hourly');
});

const HOUR      = new Date('2026-05-21T10:00:00Z');
const NEXT_HOUR = new Date('2026-05-21T11:00:00Z');

function makeRow(overrides = {}) {
  return {
    hour: HOUR,
    type: 'ilp',
    creates: 1, finishes: 1, cancels: 0,
    xrpCreated: 500, xrpFinished: 500, xrpCancelled: 0,
    ttfLt5s: 1, ttfLt30s: 0, ttfLt5m: 0, ttfLt1h: 0, ttfLt1d: 0, ttfGte1d: 0,
    ...overrides,
  };
}

test('upsert inserts a new row', async () => {
  if (!dbAvailable) return test.skip();
  await upsertEscrowBuckets(pool, [makeRow()]);
  const rows = await queryEscrowBuckets(pool, { from: HOUR, to: NEXT_HOUR, type: 'ilp' });
  expect(rows).toHaveLength(1);
  expect(rows[0].creates).toBe(1);
  expect(rows[0].finishes).toBe(1);
  expect(rows[0].ttfLt5s).toBe(1);
});

test('upsert accumulates on conflict', async () => {
  if (!dbAvailable) return test.skip();
  await upsertEscrowBuckets(pool, [makeRow({ creates: 2, finishes: 1, xrpCreated: 1000, ttfLt5s: 1 })]);
  await upsertEscrowBuckets(pool, [makeRow({ creates: 3, finishes: 2, xrpCreated: 1500, ttfLt5s: 2 })]);
  const rows = await queryEscrowBuckets(pool, { from: HOUR, to: NEXT_HOUR, type: 'ilp' });
  expect(rows[0].creates).toBe(5);
  expect(rows[0].finishes).toBe(3);
  expect(rows[0].ttfLt5s).toBe(3);
});

test('query filters by type', async () => {
  if (!dbAvailable) return test.skip();
  await upsertEscrowBuckets(pool, [
    makeRow({ type: 'ilp',       creates: 5 }),
    makeRow({ type: 'time_lock', creates: 3 }),
  ]);
  const ilpRows  = await queryEscrowBuckets(pool, { from: HOUR, to: NEXT_HOUR, type: 'ilp' });
  const tlRows   = await queryEscrowBuckets(pool, { from: HOUR, to: NEXT_HOUR, type: 'time_lock' });
  expect(ilpRows[0].creates).toBe(5);
  expect(tlRows[0].creates).toBe(3);
});

test('query filters by time range', async () => {
  if (!dbAvailable) return test.skip();
  await upsertEscrowBuckets(pool, [
    makeRow({ hour: HOUR }),
    makeRow({ hour: NEXT_HOUR }),
  ]);
  const rows = await queryEscrowBuckets(pool, { from: HOUR, to: NEXT_HOUR, type: 'ilp' });
  expect(rows).toHaveLength(1);
  expect(new Date(rows[0].hour).toISOString()).toBe(HOUR.toISOString());
});

test('upsert is transactional — rolls back all rows on error', async () => {
  if (!dbAvailable) return test.skip();
  const badRow = makeRow({ type: null }); // violates NOT NULL
  await expect(upsertEscrowBuckets(pool, [makeRow(), badRow])).rejects.toThrow();
  const rows = await queryEscrowBuckets(pool, { from: HOUR, to: NEXT_HOUR, type: 'ilp' });
  expect(rows).toHaveLength(0);
});

test('returns numeric fields as strings (NUMERIC cast)', async () => {
  if (!dbAvailable) return test.skip();
  await upsertEscrowBuckets(pool, [makeRow({ xrpCreated: 12345.678 })]);
  const rows = await queryEscrowBuckets(pool, { from: HOUR, to: NEXT_HOUR, type: 'ilp' });
  expect(typeof rows[0].xrpCreated).toBe('string');
});
