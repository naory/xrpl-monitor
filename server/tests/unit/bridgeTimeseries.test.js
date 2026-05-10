const { WINDOWS, BUCKET_MS } = require('../../src/redis/bridgeTimeseries');

describe('WINDOWS', () => {
  it('defines 10m, 1h, 24h in milliseconds', () => {
    expect(WINDOWS['10m']).toBe(10 * 60 * 1000);
    expect(WINDOWS['1h']).toBe(60 * 60 * 1000);
    expect(WINDOWS['24h']).toBe(24 * 60 * 60 * 1000);
  });

  it('has no unknown keys', () => {
    expect(Object.keys(WINDOWS)).toEqual(['10m', '1h', '24h']);
  });
});

describe('BUCKET_MS', () => {
  it('defines bucket sizes per window', () => {
    expect(BUCKET_MS['10m']).toBe(30_000);
    expect(BUCKET_MS['1h']).toBe(5 * 60_000);
    expect(BUCKET_MS['24h']).toBe(60 * 60_000);
  });

  it('has exactly the same keys as WINDOWS', () => {
    expect(Object.keys(BUCKET_MS).sort()).toEqual(Object.keys(WINDOWS).sort());
  });
});
