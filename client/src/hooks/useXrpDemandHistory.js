import { useQuery } from '@tanstack/react-query';
import { fetchXrpDemandBuckets } from '../api/http';

export const BUCKET_MS  = { '10m': 30_000,       '1h': 5 * 60_000,     '24h': 60 * 60_000 };
export const WINDOWS_MS = { '10m': 10 * 60_000,   '1h': 60 * 60_000,    '24h': 24 * 60 * 60_000 };
const TOP_N = 5;

export function aggregateXrpDemandBuckets(buckets, timeWindow, now = Date.now()) {
  if (!BUCKET_MS[timeWindow] || !WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
  const bucketMs    = BUCKET_MS[timeWindow];
  const windowMs    = WINDOWS_MS[timeWindow];
  const windowStart = now - windowMs;
  const numBuckets  = Math.ceil(windowMs / bucketMs);

  const summary        = {};
  const currencyTotals = {};

  for (const b of buckets) {
    const bought = parseFloat(b.xrpBought) || 0;
    const sold   = parseFloat(b.xrpSold)   || 0;
    const total  = bought + sold;
    const { currency, eventCount } = b;
    const prev = summary[currency] ?? { bought: 0, sold: 0, count: 0 };
    summary[currency] = {
      bought: prev.bought + bought,
      sold:   prev.sold   + sold,
      count:  prev.count  + eventCount,
    };
    currencyTotals[currency] = (currencyTotals[currency] ?? 0) + total;
  }

  for (const c of Object.keys(summary)) {
    summary[c].balance = summary[c].bought - summary[c].sold;
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
    const ts    = new Date(b.hour).getTime();
    const total = (parseFloat(b.xrpBought) || 0) + (parseFloat(b.xrpSold) || 0);
    const idx   = Math.floor((ts - windowStart) / bucketMs);
    if (idx < 0 || idx >= numBuckets) continue;
    const key = topCurrencies.includes(b.currency) ? b.currency : 'other';
    series[idx].currencies[key] = (series[idx].currencies[key] ?? 0) + total;
  }

  return { summary, series, topCurrencies };
}

export function useXrpDemandHistory(timeWindow) {
  return useQuery({
    queryKey:        ['xrp-demand-history', timeWindow],
    queryFn:         async () => {
      if (!WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
      const to   = new Date().toISOString();
      const from = new Date(Date.now() - WINDOWS_MS[timeWindow]).toISOString();
      const { buckets } = await fetchXrpDemandBuckets(from, to);
      return aggregateXrpDemandBuckets(buckets, timeWindow);
    },
    refetchInterval: 30_000,
    staleTime:       15_000,
    enabled:         !!timeWindow,
  });
}
