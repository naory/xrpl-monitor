import { describe, it, expect } from 'vitest';
import { aggregateBridgeEvents, BUCKET_MS, WINDOWS_MS } from './useBridgeHistory';

function makeEvent(overrides = {}) {
  return {
    txHash:       'TX001',
    ledgerTime:   new Date().toISOString(),
    fromCurrency: 'USD',
    toCurrency:   'EUR',
    xrpValue:     '100',
    fromValue:    '50',
    toValue:      '46',
    ...overrides,
  };
}

describe('aggregateBridgeEvents', () => {
  const now = Date.now();

  it('builds summary with fromVolume and toVolume per currency', () => {
    const events = [makeEvent({ ledgerTime: new Date(now - 60_000).toISOString() })];
    const { summary } = aggregateBridgeEvents(events, '1h', now);
    expect(summary['USD'].fromVolume).toBeCloseTo(100);
    expect(summary['USD'].toVolume).toBe(0);
    expect(summary['EUR'].toVolume).toBeCloseTo(100);
    expect(summary['EUR'].fromVolume).toBe(0);
    expect(summary['USD'].count).toBe(1);
    expect(summary['EUR'].count).toBe(1);
  });

  it('accumulates multiple events for the same currency', () => {
    const events = [
      makeEvent({ txHash: 'TX1', ledgerTime: new Date(now - 60_000).toISOString(), xrpValue: '100' }),
      makeEvent({ txHash: 'TX2', ledgerTime: new Date(now - 30_000).toISOString(), xrpValue: '50'  }),
    ];
    const { summary } = aggregateBridgeEvents(events, '1h', now);
    expect(summary['USD'].fromVolume).toBeCloseTo(150);
    expect(summary['USD'].count).toBe(2);
  });

  it('returns topCurrencies sorted by total volume descending, max 5', () => {
    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'];
    const events = currencies.map((fc, i) =>
      makeEvent({ txHash: `TX${i}`, fromCurrency: fc, toCurrency: 'XAH', xrpValue: String((6 - i) * 10), ledgerTime: new Date(now - 60_000).toISOString() })
    );
    const { topCurrencies } = aggregateBridgeEvents(events, '1h', now);
    expect(topCurrencies).toHaveLength(5);
    expect(topCurrencies[0]).toBe('XAH'); // highest volume: 60+50+40+30+20+10 = 210
    expect(topCurrencies).toContain('USD'); // second: 60
    expect(topCurrencies).toContain('EUR'); // third: 50
  });

  it('returns correct number of buckets for each window', () => {
    const ev = makeEvent({ ledgerTime: new Date(now - 60_000).toISOString() });
    expect(aggregateBridgeEvents([ev], '10m', now).series).toHaveLength(20);
    expect(aggregateBridgeEvents([ev], '1h',  now).series).toHaveLength(12);
    expect(aggregateBridgeEvents([ev], '24h', now).series).toHaveLength(24);
  });

  it('places events in correct bucket', () => {
    const bucketMs = BUCKET_MS['1h']; // 5min
    const windowMs = WINDOWS_MS['1h'];
    const windowStart = now - windowMs;
    const ts = now - 7 * 60_000; // 7 minutes ago
    const expectedIdx = Math.floor((ts - windowStart) / bucketMs);
    const ev = makeEvent({ ledgerTime: new Date(ts).toISOString() });
    const { series } = aggregateBridgeEvents([ev], '1h', now);
    const bucketTotal = Object.values(series[expectedIdx].currencies).reduce((a, b) => a + b, 0);
    expect(bucketTotal).toBeCloseTo(100);
  });

  it('groups currencies beyond top 5 into "other"', () => {
    const currencies = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const events = currencies.map((fc, i) =>
      makeEvent({ txHash: `TX${i}`, fromCurrency: fc, toCurrency: 'Z', xrpValue: '10', ledgerTime: new Date(now - 60_000).toISOString() })
    );
    const { series, topCurrencies } = aggregateBridgeEvents(events, '1h', now);
    expect(topCurrencies).toHaveLength(5);
    const anyBucketHasOther = series.some((b) => b.currencies['other'] > 0);
    expect(anyBucketHasOther).toBe(true);
  });
});
