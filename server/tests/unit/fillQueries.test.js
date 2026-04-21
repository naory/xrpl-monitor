const { buildFillsQuery, clampLimit } = require('../../src/db/fillQueries');

describe('clampLimit', () => {
  it('returns the value when within range', () => {
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(200)).toBe(200);
  });

  it('clamps to 200 when limit exceeds max', () => {
    expect(clampLimit(500)).toBe(200);
  });

  it('falls back to default 50 for invalid inputs', () => {
    expect(clampLimit(0)).toBe(50);
    expect(clampLimit(-1)).toBe(50);
    expect(clampLimit('abc')).toBe(50);
    expect(clampLimit(null)).toBe(50);
    expect(clampLimit(undefined)).toBe(50);
  });
});

describe('buildFillsQuery', () => {
  it('produces a base SELECT with LIMIT when no filters are given', () => {
    const { sql, params } = buildFillsQuery({});
    expect(sql).toMatch(/SELECT/i);
    expect(sql).toMatch(/FROM trade_fills/i);
    expect(sql).toMatch(/ORDER BY id DESC/i);
    expect(sql).toMatch(/LIMIT \$1/i);
    expect(params).toEqual([50]);
  });

  it('applies a cursor as id < $N before the LIMIT', () => {
    const { sql, params } = buildFillsQuery({ cursor: '1000' });
    expect(sql).toMatch(/id < \$1/i);
    expect(params[0]).toBe(1000);
    expect(sql).toMatch(/LIMIT \$2/i);
    expect(params[1]).toBe(50);
  });

  it('applies account filter', () => {
    const { sql, params } = buildFillsQuery({ account: 'rMaker1' });
    expect(sql).toMatch(/account = \$1/i);
    expect(params[0]).toBe('rMaker1');
  });

  it('applies getCurrency filter', () => {
    const { sql, params } = buildFillsQuery({ getCurrency: 'USD' });
    expect(sql).toMatch(/gets_currency = \$/i);
    expect(params).toContain('USD');
  });

  it('applies payCurrency filter', () => {
    const { sql, params } = buildFillsQuery({ payCurrency: 'XRP' });
    expect(sql).toMatch(/pays_currency = \$/i);
    expect(params).toContain('XRP');
  });

  it('applies from/to date range filters', () => {
    const from = '2025-01-01T00:00:00Z';
    const to   = '2025-01-02T00:00:00Z';
    const { sql, params } = buildFillsQuery({ from, to });
    expect(sql).toMatch(/ledger_time >= \$/i);
    expect(sql).toMatch(/ledger_time <= \$/i);
    expect(params).toContainEqual(new Date(from));
    expect(params).toContainEqual(new Date(to));
  });

  it('ignores invalid date strings for from/to', () => {
    const { sql, params } = buildFillsQuery({ from: 'not-a-date', to: 'also-bad' });
    expect(sql).not.toMatch(/WHERE/i);
    expect(params.some((p) => p instanceof Date)).toBe(false);
  });

  it('uses a custom limit', () => {
    const { sql, params } = buildFillsQuery({ limit: '10' });
    expect(params).toContain(10);
  });

  it('clamps limit to 200', () => {
    const { params } = buildFillsQuery({ limit: '999' });
    expect(params).toContain(200);
  });

  it('stacks multiple filters with AND', () => {
    const { sql, params } = buildFillsQuery({ account: 'rA', getCurrency: 'USD', payCurrency: 'XRP' });
    expect(sql.match(/AND/gi)?.length).toBeGreaterThanOrEqual(2);
    expect(params).toContain('rA');
    expect(params).toContain('USD');
    expect(params).toContain('XRP');
  });

  it('selects id as part of the result for cursor extraction', () => {
    const { sql } = buildFillsQuery({});
    expect(sql).toMatch(/\bid\b/i);
  });
});
