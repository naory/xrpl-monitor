import { describe, it, expect } from 'vitest';
import { aggregateBridgeBuckets, BUCKET_MS, WINDOWS_MS } from './useBridgeHistory';

function makeBucket(overrides = {}) {
  return {
    hour:         new Date().toISOString(),
    fromCurrency: 'USD',
    fromIssuer:   'rIssuer1',
    toCurrency:   'EUR',
    toIssuer:     'rIssuer2',
    fromVolume:   '50',
    toVolume:     '46',
    xrpVolume:    '100',
    eventCount:   1,
    ...overrides,
  };
}

describe('aggregateBridgeBuckets', () => {
  const now = Date.now();

  it('builds summary with fromVolume and toVolume per currency using xrpVolume', () => {
    const buckets = [makeBucket({ hour: new Date(now - 60_000).toISOString() })];
    const { summary } = aggregateBridgeBuckets(buckets, '1h', now);
    expect(summary['USD'].fromVolume).toBeCloseTo(100);
    expect(summary['USD'].toVolume).toBe(0);
    expect(summary['EUR'].toVolume).toBeCloseTo(100);
    expect(summary['EUR'].fromVolume).toBe(0);
    expect(summary['USD'].count).toBe(1);
    expect(summary['EUR'].count).toBe(1);
  });

  it('accumulates multiple buckets for the same currency', () => {
    const buckets = [
      makeBucket({ hour: new Date(now - 60 * 60_000).toISOString(), xrpVolume: '100' }),
      makeBucket({ hour: new Date(now - 30 * 60_000).toISOString(), xrpVolume: '50'  }),
    ];
    const { summary } = aggregateBridgeBuckets(buckets, '24h', now);
    expect(summary['USD'].fromVolume).toBeCloseTo(150);
    expect(summary['USD'].count).toBe(2);
  });

  it('returns topCurrencies sorted by total volume descending, max 5', () => {
    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'];
    const buckets = currencies.map((fc, i) =>
      makeBucket({
        hour: new Date(now - 60_000).toISOString(),
        fromCurrency: fc, toCurrency: 'XAH',
        fromIssuer: '', toIssuer: '',
        xrpVolume: String((6 - i) * 10),
        eventCount: 1,
      })
    );
    const { topCurrencies } = aggregateBridgeBuckets(buckets, '24h', now);
    expect(topCurrencies).toHaveLength(5);
    expect(topCurrencies[0]).toBe('XAH');
    expect(topCurrencies).toContain('USD');
    expect(topCurrencies).toContain('EUR');
  });

  it('returns correct number of chart buckets for each window', () => {
    const b = makeBucket({ hour: new Date(now - 60_000).toISOString() });
    expect(aggregateBridgeBuckets([b], '10m', now).series).toHaveLength(20);
    expect(aggregateBridgeBuckets([b], '1h',  now).series).toHaveLength(12);
    expect(aggregateBridgeBuckets([b], '24h', now).series).toHaveLength(24);
  });

  it('places bucket volume in the correct chart slot', () => {
    const bucketMs  = BUCKET_MS['24h']; // 1h
    const windowMs  = WINDOWS_MS['24h'];
    const windowStart = now - windowMs;
    const ts = now - 3 * 60 * 60_000; // 3 hours ago
    const expectedIdx = Math.floor((ts - windowStart) / bucketMs);
    const b = makeBucket({ hour: new Date(ts).toISOString(), xrpVolume: '200' });
    const { series } = aggregateBridgeBuckets([b], '24h', now);
    const total = Object.values(series[expectedIdx].currencies).reduce((a, v) => a + v, 0);
    expect(total).toBeCloseTo(200);
  });

  it('groups currencies beyond top 5 into "other"', () => {
    const currencies = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const buckets = currencies.map((fc, i) =>
      makeBucket({
        hour: new Date(now - 60_000).toISOString(),
        fromCurrency: fc, toCurrency: 'Z',
        fromIssuer: '', toIssuer: '',
        xrpVolume: '10', eventCount: 1,
      })
    );
    const { series, topCurrencies } = aggregateBridgeBuckets(buckets, '24h', now);
    expect(topCurrencies).toHaveLength(5);
    const anyBucketHasOther = series.some((b) => b.currencies['other'] > 0);
    expect(anyBucketHasOther).toBe(true);
  });

  it('throws for unknown timeWindow', () => {
    expect(() => aggregateBridgeBuckets([], '7d')).toThrow('Unknown timeWindow');
  });
});
