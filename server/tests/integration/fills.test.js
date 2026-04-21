/**
 * Integration tests for trade_fills DB writer.
 * Requires a running Postgres instance (via docker-compose).
 * Skips gracefully if DB is unavailable.
 */
const { Pool } = require('pg');
const { writeFills, getLastLedgerIndex } = require('../../src/db/fills');

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
    await pool.query('TRUNCATE TABLE trade_fills RESTART IDENTITY');
    dbAvailable = true;
  } catch {
    console.warn('[INTEGRATION] Postgres unavailable — skipping fills tests');
  }
});

afterAll(async () => {
  await pool.end();
});

const sampleFill = {
  ledgerIndex: 90000001,
  ledgerTime: new Date('2025-01-01T00:00:00Z'),
  txHash: 'AABBCC0011',
  account: 'rMakerTest1',
  getsCurrency: 'USD',
  getsIssuer: 'rIssuer1',
  getsValue: '10',
  paysCurrency: 'XRP',
  paysIssuer: null,
  paysValue: '5.000000',
  fillType: 'full',
  pairKey: 'XRP:/USD:rIssuer1',
};

describe('writeFills', () => {
  it('inserts a fill row into trade_fills', async () => {
    if (!dbAvailable) return;

    await writeFills(pool, [sampleFill]);

    const { rows } = await pool.query('SELECT * FROM trade_fills WHERE tx_hash = $1', [sampleFill.txHash]);
    expect(rows).toHaveLength(1);
    expect(rows[0].account).toBe('rMakerTest1');
    expect(rows[0].gets_currency).toBe('USD');
    expect(parseFloat(rows[0].gets_value)).toBeCloseTo(10);
    expect(rows[0].pays_currency).toBe('XRP');
  });

  it('is idempotent — duplicate inserts are silently ignored', async () => {
    if (!dbAvailable) return;

    await writeFills(pool, [sampleFill]);
    await writeFills(pool, [sampleFill]);

    const { rows } = await pool.query('SELECT * FROM trade_fills WHERE tx_hash = $1', [sampleFill.txHash]);
    expect(rows).toHaveLength(1);
  });

  it('inserts multiple fills in one call', async () => {
    if (!dbAvailable) return;

    const fills = [
      { ...sampleFill, txHash: 'MULTI001', account: 'rMakerA' },
      { ...sampleFill, txHash: 'MULTI002', account: 'rMakerB' },
    ];
    await writeFills(pool, fills);

    const { rows } = await pool.query(
      "SELECT * FROM trade_fills WHERE tx_hash IN ('MULTI001','MULTI002')"
    );
    expect(rows).toHaveLength(2);
  });

  it('is a no-op for an empty fills array', async () => {
    if (!dbAvailable) return;
    await expect(writeFills(pool, [])).resolves.not.toThrow();
  });
});

describe('getLastLedgerIndex', () => {
  it('returns null when table is empty', async () => {
    if (!dbAvailable) return;

    await pool.query('TRUNCATE TABLE trade_fills RESTART IDENTITY');
    const result = await getLastLedgerIndex(pool);
    expect(result).toBeNull();
  });

  it('returns the highest ledger_index present', async () => {
    if (!dbAvailable) return;

    await writeFills(pool, [
      { ...sampleFill, txHash: 'L001', account: 'rA', ledgerIndex: 100 },
      { ...sampleFill, txHash: 'L002', account: 'rB', ledgerIndex: 200 },
    ]);

    const result = await getLastLedgerIndex(pool);
    expect(result).toBe(200);
  });
});
