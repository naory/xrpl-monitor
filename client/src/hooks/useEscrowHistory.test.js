import { describe, it, expect } from 'vitest';
import { aggregateEscrowBuckets, BUCKET_MS, WINDOWS_MS } from './useEscrowHistory';

function makeBucket(overrides = {}) {
  return {
    hour:         new Date().toISOString(),
    type:         'ilp',
    creates:      2,
    finishes:     1,
    cancels:      0,
    xrpCreated:   '500',
    xrpFinished:  '500',
    xrpCancelled: '0',
    ttfLt5s:      1,
    ttfLt30s:     0,
    ttfLt5m:      0,
    ttfLt1h:      0,
    ttfLt1d:      0,
    ttfGte1d:     0,
    ...overrides,
  };
}

describe('aggregateEscrowBuckets', () => {
  const now = Date.now();

  it('throws for unknown timeWindow', () => {
    expect(() => aggregateEscrowBuckets([], '7d', now)).toThrow('Unknown timeWindow');
  });

  it('returns zero summary for empty buckets', () => {
    const { summary } = aggregateEscrowBuckets([], '24h', now);
    expect(summary.creates).toBe(0);
    expect(summary.finishes).toBe(0);
    expect(summary.cancels).toBe(0);
    expect(summary.successRate).toBeNull();
    expect(summary.medianTtfLabel).toBe('—');
  });

  it('computes successRate as finishes / (finishes + cancels)', () => {
    const buckets = [
      makeBucket({ finishes: 3, cancels: 1, hour: new Date(now - 60_000).toISOString() }),
    ];
    const { summary } = aggregateEscrowBuckets(buckets, '1h', now);
    expect(summary.successRate).toBeCloseTo(0.75);
  });

  it('returns null successRate when no settled escrows', () => {
    const buckets = [makeBucket({ finishes: 0, cancels: 0, hour: new Date(now - 60_000).toISOString() })];
    const { summary } = aggregateEscrowBuckets(buckets, '1h', now);
    expect(summary.successRate).toBeNull();
  });

  it('sums XRP volumes across buckets', () => {
    const buckets = [
      makeBucket({ xrpCreated: '1000', xrpFinished: '800', xrpCancelled: '0', hour: new Date(now - 60_000).toISOString() }),
      makeBucket({ xrpCreated: '500',  xrpFinished: '0',   xrpCancelled: '500', hour: new Date(now - 120_000).toISOString() }),
    ];
    const { summary } = aggregateEscrowBuckets(buckets, '24h', now);
    expect(summary.xrpCreated).toBeCloseTo(1500);
    expect(summary.xrpFinished).toBeCloseTo(800);
    expect(summary.xrpCancelled).toBeCloseTo(500);
  });

  it('sums TTF buckets across rows', () => {
    const buckets = [
      makeBucket({ ttfLt5s: 3, ttfLt30s: 1, hour: new Date(now - 60_000).toISOString() }),
      makeBucket({ ttfLt5s: 2, ttfLt30s: 2, hour: new Date(now - 120_000).toISOString() }),
    ];
    const { summary } = aggregateEscrowBuckets(buckets, '24h', now);
    expect(summary.ttfBuckets.lt5s).toBe(5);
    expect(summary.ttfBuckets.lt30s).toBe(3);
  });

  it('returns medianTtfLabel from majority bucket', () => {
    const buckets = [
      makeBucket({ finishes: 10, ttfLt5s: 8, ttfLt30s: 2, hour: new Date(now - 60_000).toISOString() }),
    ];
    const { summary } = aggregateEscrowBuckets(buckets, '24h', now);
    expect(summary.medianTtfLabel).toBe('2.5s');
  });

  it('returns correct number of series buckets per window', () => {
    const b = makeBucket({ hour: new Date(now - 60_000).toISOString() });
    expect(aggregateEscrowBuckets([b], '10m', now).series).toHaveLength(20);
    expect(aggregateEscrowBuckets([b], '1h',  now).series).toHaveLength(12);
    expect(aggregateEscrowBuckets([b], '24h', now).series).toHaveLength(24);
  });

  it('places finishes and cancels in correct series slot', () => {
    const bucketMs    = BUCKET_MS['24h'];
    const windowMs    = WINDOWS_MS['24h'];
    const windowStart = now - windowMs;
    const ts = now - 3 * 60 * 60_000;
    const idx = Math.floor((ts - windowStart) / bucketMs);
    const b = makeBucket({ hour: new Date(ts).toISOString(), finishes: 4, cancels: 2 });
    const { series } = aggregateEscrowBuckets([b], '24h', now);
    expect(series[idx].finishes).toBe(4);
    expect(series[idx].cancels).toBe(2);
  });
});
