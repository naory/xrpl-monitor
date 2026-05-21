import { describe, it, expect } from 'vitest';
import { aggregateXrpDemandBuckets, BUCKET_MS, WINDOWS_MS } from './useXrpDemandHistory';

function makeBucket(overrides = {}) {
  return {
    hour:       new Date().toISOString(),
    currency:   'USD',
    xrpBought:  '500',
    xrpSold:    '700',
    eventCount: 2,
    ...overrides,
  };
}

describe('aggregateXrpDemandBuckets', () => {
  const now = Date.now();

  it('builds summary with bought, sold, balance, count per currency', () => {
    const buckets = [makeBucket({ hour: new Date(now - 60_000).toISOString() })];
    const { summary } = aggregateXrpDemandBuckets(buckets, '1h', now);
    expect(summary['USD'].bought).toBeCloseTo(500);
    expect(summary['USD'].sold).toBeCloseTo(700);
    expect(summary['USD'].balance).toBeCloseTo(-200);
    expect(summary['USD'].count).toBe(2);
  });

  it('accumulates multiple buckets for the same currency', () => {
    const buckets = [
      makeBucket({ hour: new Date(now - 60 * 60_000).toISOString(), xrpBought: '100', xrpSold: '200' }),
      makeBucket({ hour: new Date(now - 30 * 60_000).toISOString(), xrpBought: '400', xrpSold: '300' }),
    ];
    const { summary } = aggregateXrpDemandBuckets(buckets, '24h', now);
    expect(summary['USD'].bought).toBeCloseTo(500);
    expect(summary['USD'].sold).toBeCloseTo(500);
    expect(summary['USD'].balance).toBeCloseTo(0);
    expect(summary['USD'].count).toBe(4);
  });

  it('returns topCurrencies sorted by total volume (bought+sold) descending, max 5', () => {
    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'];
    const buckets = currencies.map((c, i) =>
      makeBucket({
        hour: new Date(now - 60_000).toISOString(),
        currency: c,
        xrpBought: String((6 - i) * 100),
        xrpSold:   String((6 - i) * 50),
        eventCount: 1,
      })
    );
    const { topCurrencies } = aggregateXrpDemandBuckets(buckets, '24h', now);
    expect(topCurrencies).toHaveLength(5);
    expect(topCurrencies[0]).toBe('USD');
    expect(topCurrencies).not.toContain('ETH');
  });

  it('returns correct number of chart buckets for each window', () => {
    const b = makeBucket({ hour: new Date(now - 60_000).toISOString() });
    expect(aggregateXrpDemandBuckets([b], '10m', now).series).toHaveLength(20);
    expect(aggregateXrpDemandBuckets([b], '1h',  now).series).toHaveLength(12);
    expect(aggregateXrpDemandBuckets([b], '24h', now).series).toHaveLength(24);
  });

  it('places bucket volume (bought+sold) in the correct chart slot', () => {
    const bucketMs    = BUCKET_MS['24h'];
    const windowMs    = WINDOWS_MS['24h'];
    const windowStart = now - windowMs;
    const ts = now - 3 * 60 * 60_000;
    const expectedIdx = Math.floor((ts - windowStart) / bucketMs);
    const b = makeBucket({ hour: new Date(ts).toISOString(), xrpBought: '300', xrpSold: '200' });
    const { series } = aggregateXrpDemandBuckets([b], '24h', now);
    const total = Object.values(series[expectedIdx].currencies).reduce((a, v) => a + v, 0);
    expect(total).toBeCloseTo(500);
  });

  it('groups currencies beyond top 5 into "other"', () => {
    const currencies = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const buckets = currencies.map((c) =>
      makeBucket({ hour: new Date(now - 60_000).toISOString(), currency: c, xrpBought: '100', xrpSold: '50', eventCount: 1 })
    );
    const { series, topCurrencies } = aggregateXrpDemandBuckets(buckets, '24h', now);
    expect(topCurrencies).toHaveLength(5);
    const anyBucketHasOther = series.some((b) => b.currencies['other'] > 0);
    expect(anyBucketHasOther).toBe(true);
  });

  it('throws for unknown timeWindow', () => {
    expect(() => aggregateXrpDemandBuckets([], '7d')).toThrow('Unknown timeWindow');
  });

  it('returns bought-only bucket correctly (balance = bought)', () => {
    const buckets = [makeBucket({ hour: new Date(now - 60_000).toISOString(), xrpBought: '1000', xrpSold: '0' })];
    const { summary } = aggregateXrpDemandBuckets(buckets, '1h', now);
    expect(summary['USD'].balance).toBeCloseTo(1000);
    expect(summary['USD'].sold).toBeCloseTo(0);
  });

  it('returns sold-only bucket correctly (balance = -sold)', () => {
    const buckets = [makeBucket({ hour: new Date(now - 60_000).toISOString(), xrpBought: '0', xrpSold: '500' })];
    const { summary } = aggregateXrpDemandBuckets(buckets, '1h', now);
    expect(summary['USD'].balance).toBeCloseTo(-500);
    expect(summary['USD'].bought).toBeCloseTo(0);
  });
});
