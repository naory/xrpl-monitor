import { useQuery } from '@tanstack/react-query';
import { fetchEscrowBuckets } from '../api/http';

export const BUCKET_MS  = { '10m': 30_000, '1h': 5 * 60_000, '24h': 60 * 60_000 };
export const WINDOWS_MS = { '10m': 10 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 };

const TTF_KEYS      = ['ttfLt5s', 'ttfLt30s', 'ttfLt5m', 'ttfLt1h', 'ttfLt1d', 'ttfGte1d'];
const TTF_MIDPOINTS = ['2.5s', '17s', '2.5m', '32m', '12.5h', '>1d'];

function medianTtfLabel(ttfBuckets) {
  const total = TTF_KEYS.reduce((s, k) => s + (ttfBuckets[k] ?? 0), 0);
  if (total === 0) return '—';
  const mid = total / 2;
  let cum = 0;
  for (let i = 0; i < TTF_KEYS.length; i++) {
    cum += ttfBuckets[TTF_KEYS[i]] ?? 0;
    if (cum >= mid) return TTF_MIDPOINTS[i];
  }
  return TTF_MIDPOINTS[TTF_MIDPOINTS.length - 1];
}

export function aggregateEscrowBuckets(buckets, timeWindow, now = Date.now()) {
  if (!BUCKET_MS[timeWindow] || !WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
  const bucketMs    = BUCKET_MS[timeWindow];
  const windowMs    = WINDOWS_MS[timeWindow];
  const windowStart = now - windowMs;
  const numBuckets  = Math.ceil(windowMs / bucketMs);

  const raw = { ttfLt5s: 0, ttfLt30s: 0, ttfLt5m: 0, ttfLt1h: 0, ttfLt1d: 0, ttfGte1d: 0 };
  const summary = {
    creates: 0, finishes: 0, cancels: 0,
    xrpCreated: 0, xrpFinished: 0, xrpCancelled: 0,
    successRate: null,
    ttfBuckets: { lt5s: 0, lt30s: 0, lt5m: 0, lt1h: 0, lt1d: 0, gte1d: 0 },
    medianTtfLabel: '—',
  };

  for (const b of buckets) {
    summary.creates      += b.creates      ?? 0;
    summary.finishes     += b.finishes     ?? 0;
    summary.cancels      += b.cancels      ?? 0;
    summary.xrpCreated   += parseFloat(b.xrpCreated)   || 0;
    summary.xrpFinished  += parseFloat(b.xrpFinished)  || 0;
    summary.xrpCancelled += parseFloat(b.xrpCancelled) || 0;
    raw.ttfLt5s  += b.ttfLt5s  ?? 0;
    raw.ttfLt30s += b.ttfLt30s ?? 0;
    raw.ttfLt5m  += b.ttfLt5m  ?? 0;
    raw.ttfLt1h  += b.ttfLt1h  ?? 0;
    raw.ttfLt1d  += b.ttfLt1d  ?? 0;
    raw.ttfGte1d += b.ttfGte1d ?? 0;
  }

  summary.ttfBuckets = { lt5s: raw.ttfLt5s, lt30s: raw.ttfLt30s, lt5m: raw.ttfLt5m, lt1h: raw.ttfLt1h, lt1d: raw.ttfLt1d, gte1d: raw.ttfGte1d };
  const settled = summary.finishes + summary.cancels;
  summary.successRate    = settled > 0 ? summary.finishes / settled : null;
  summary.medianTtfLabel = medianTtfLabel(raw);

  const series = Array.from({ length: numBuckets }, (_, i) => ({
    ts: windowStart + i * bucketMs,
    finishes: 0,
    cancels:  0,
  }));

  for (const b of buckets) {
    const ts  = new Date(b.hour).getTime();
    const idx = Math.floor((ts - windowStart) / bucketMs);
    if (idx < 0 || idx >= numBuckets) continue;
    series[idx].finishes += b.finishes ?? 0;
    series[idx].cancels  += b.cancels  ?? 0;
  }

  return { summary, series, topCurrencies: [] };
}

export function useEscrowHistory(type, timeWindow) {
  return useQuery({
    queryKey:        ['escrow-history', type, timeWindow],
    queryFn:         async () => {
      if (!WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
      const typeSlug = type === 'time_lock' ? 'time-lock' : 'ilp';
      const to   = new Date().toISOString();
      const from = new Date(Date.now() - WINDOWS_MS[timeWindow]).toISOString();
      const { buckets } = await fetchEscrowBuckets(typeSlug, from, to);
      return aggregateEscrowBuckets(buckets, timeWindow);
    },
    refetchInterval: 30_000,
    staleTime:       15_000,
    enabled:         !!timeWindow && !!type,
  });
}
