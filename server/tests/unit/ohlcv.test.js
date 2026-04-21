const { parsePairKey, buildOhlcvQuery } = require('../../src/db/ohlcv');

describe('parsePairKey', () => {
  it('splits a canonical XRP/token pair', () => {
    const r = parsePairKey('XRP|~USD|rIssuer1');
    expect(r.getCurrency).toBe('XRP');
    expect(r.getIssuer).toBeNull();
    expect(r.payCurrency).toBe('USD');
    expect(r.payIssuer).toBe('rIssuer1');
  });

  it('splits a token/token pair', () => {
    const r = parsePairKey('EUR|rIssuerA~USD|rIssuerB');
    expect(r.getCurrency).toBe('EUR');
    expect(r.getIssuer).toBe('rIssuerA');
    expect(r.payCurrency).toBe('USD');
    expect(r.payIssuer).toBe('rIssuerB');
  });

  it('handles empty issuer as null', () => {
    const r = parsePairKey('XRP|~USD|rIssuer1');
    expect(r.getIssuer).toBeNull();
  });

  it('throws for a malformed pairKey', () => {
    expect(() => parsePairKey('NOPAIR')).toThrow();
  });
});

describe('buildOhlcvQuery', () => {
  it('returns sql and params', () => {
    const { sql, params } = buildOhlcvQuery({
      getCurrency: 'XRP', getIssuer: null,
      payCurrency: 'USD', payIssuer: 'rIssuer1',
    });
    expect(typeof sql).toBe('string');
    expect(Array.isArray(params)).toBe(true);
  });

  it('sql includes GROUP BY and ORDER BY bucket_time', () => {
    const { sql } = buildOhlcvQuery({ getCurrency: 'XRP', getIssuer: null, payCurrency: 'USD', payIssuer: 'rI' });
    expect(sql).toMatch(/GROUP BY/i);
    expect(sql).toMatch(/ORDER BY/i);
    expect(sql).toMatch(/bucket_time/i);
  });

  it('sql selects open, high, low, close, volume, trade_count', () => {
    const { sql } = buildOhlcvQuery({ getCurrency: 'XRP', getIssuer: null, payCurrency: 'USD', payIssuer: 'rI' });
    expect(sql).toMatch(/open/i);
    expect(sql).toMatch(/high/i);
    expect(sql).toMatch(/low/i);
    expect(sql).toMatch(/close/i);
    expect(sql).toMatch(/volume/i);
    expect(sql).toMatch(/trade_count/i);
  });

  it('includes LIMIT param matching the limit option', () => {
    const { params } = buildOhlcvQuery({
      getCurrency: 'XRP', getIssuer: null,
      payCurrency: 'USD', payIssuer: 'rI',
      limit: 20,
    });
    expect(params).toContain(20);
  });

  it('defaults bucketSeconds to 30 and limit to 60', () => {
    const { params } = buildOhlcvQuery({ getCurrency: 'XRP', getIssuer: null, payCurrency: 'USD', payIssuer: 'rI' });
    expect(params).toContain(30);
    expect(params).toContain(60);
  });

  it('includes both currency params for both fill directions', () => {
    const { params } = buildOhlcvQuery({ getCurrency: 'XRP', getIssuer: null, payCurrency: 'USD', payIssuer: 'rI' });
    expect(params).toContain('XRP');
    expect(params).toContain('USD');
  });
});
