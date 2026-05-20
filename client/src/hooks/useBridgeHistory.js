import { useQuery } from '@tanstack/react-query';
import { fetchBridgeBuckets } from '../api/http';

export const BUCKET_MS  = { '10m': 30_000,         '1h': 5 * 60_000,        '24h': 60 * 60_000 };
export const WINDOWS_MS = { '10m': 10 * 60_000,    '1h': 60 * 60_000,       '24h': 24 * 60 * 60_000 };
const TOP_N = 5;

export function aggregateBridgeBuckets(buckets, timeWindow, now = Date.now()) {
  if (!BUCKET_MS[timeWindow] || !WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
  const bucketMs    = BUCKET_MS[timeWindow];
  const windowMs    = WINDOWS_MS[timeWindow];
  const windowStart = now - windowMs;
  const numBuckets  = Math.ceil(windowMs / bucketMs);

  const summary        = {};
  const currencyTotals = {};

  for (const b of buckets) {
    const xrp = parseFloat(b.xrpVolume) || 0;
    const { fromCurrency: fc, toCurrency: tc, eventCount } = b;
    summary[fc] = { fromVolume: (summary[fc]?.fromVolume ?? 0) + xrp, toVolume: summary[fc]?.toVolume ?? 0,  count: (summary[fc]?.count ?? 0) + eventCount };
    summary[tc] = { fromVolume: summary[tc]?.fromVolume ?? 0,          toVolume: (summary[tc]?.toVolume ?? 0) + xrp, count: (summary[tc]?.count ?? 0) + eventCount };
    currencyTotals[fc] = (currencyTotals[fc] ?? 0) + xrp;
    currencyTotals[tc] = (currencyTotals[tc] ?? 0) + xrp;
  }

  const topCurrencies = Object.entries(currencyTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([c]) => c);

  const seriesKeys = [...topCurrencies, 'other'];
  const series = Array.from({ length: numBuckets }, (_, i) => ({
    ts: windowStart + i * bucketMs,
    currencies: Object.fromEntries(seriesKeys.map((c) => [c, 0])),
  }));

  for (const b of buckets) {
    const ts  = new Date(b.hour).getTime();
    const xrp = parseFloat(b.xrpVolume) || 0;
    for (const c of [b.fromCurrency, b.toCurrency]) {
      const idx = Math.floor((ts - windowStart) / bucketMs);
      if (idx < 0 || idx >= numBuckets) continue;
      const key = topCurrencies.includes(c) ? c : 'other';
      series[idx].currencies[key] = (series[idx].currencies[key] ?? 0) + xrp / 2;
    }
  }

  return { summary, series, topCurrencies };
}

export function useBridgeHistory(timeWindow) {
  return useQuery({
    queryKey:        ['bridge-history', timeWindow],
    queryFn:         async () => {
      if (!WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
      const to   = new Date().toISOString();
      const from = new Date(Date.now() - WINDOWS_MS[timeWindow]).toISOString();
      const { buckets } = await fetchBridgeBuckets(from, to);
      const { summary, series, topCurrencies } = aggregateBridgeBuckets(buckets, timeWindow);
      return { summary, series, topCurrencies };
    },
    refetchInterval: 30_000,
    staleTime:       15_000,
    enabled:         !!timeWindow,
  });
}
