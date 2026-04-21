import { Box, Typography, Skeleton } from '@mui/material';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { useOhlcv } from '../hooks/useOhlcv';
import { useWsStore } from '../store/useWsStore';

function shortPair(pairKey) {
  const [left, right] = pairKey.split('~');
  const sym = (s) => s.split('|')[0];
  return `${sym(left)}/${sym(right ?? '')}`;
}

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  const f = parseFloat(n);
  if (f === 0) return '0';
  if (Math.abs(f) >= 1000) return f.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return f.toPrecision(5).replace(/\.?0+$/, '');
}

function fmtVolume(n) {
  if (n == null || isNaN(n)) return '—';
  const f = parseFloat(n);
  if (f >= 1e9)  return `${(f / 1e9).toFixed(2)}B`;
  if (f >= 1e6)  return `${(f / 1e6).toFixed(2)}M`;
  if (f >= 1000) return `${(f / 1000).toFixed(1)}K`;
  return f.toFixed(2);
}

const SparkTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Box sx={{ bgcolor: 'background.default', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, px: 1, py: 0.5 }}>
      <Typography variant="caption" display="block" sx={{ fontFamily: 'JetBrains Mono', fontSize: '0.65rem' }}>
        O {fmtPrice(d.open)} H {fmtPrice(d.high)}<br />L {fmtPrice(d.low)} C {fmtPrice(d.close)}
      </Typography>
    </Box>
  );
};

export function PairCard({ pairKey, window, windowVolume }) {
  const { data: candles, isLoading } = useOhlcv(pairKey, { window });
  const liveBuckets  = useWsStore((s) => s.liveBuckets[pairKey]);
  const setSelected  = useWsStore((s) => s.setSelectedPair);
  const selectedPair = useWsStore((s) => s.selectedPair);
  const isSelected   = selectedPair === pairKey;

  // Merge server candles (DESC from API) with live WS buckets
  const serverCandles = candles ? [...candles].reverse() : [];
  const liveCandles = liveBuckets
    ? Object.entries(liveBuckets)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([epoch, { candle }]) => ({
          bucket_time: new Date(Number(epoch) * 1000).toISOString(),
          ...candle,
        }))
    : [];

  const liveKeys = new Set(liveCandles.map((c) => c.bucket_time));
  const merged = [
    ...serverCandles.filter((c) => !liveKeys.has(c.bucket_time)),
    ...liveCandles,
  ].slice(-120);

  const last  = merged[merged.length - 1];
  const first = merged[0];
  const pct   = last && first && first.open
    ? ((last.close - first.open) / Math.abs(first.open)) * 100
    : null;
  const pctPos = pct != null && pct >= 0;
  const color  = pctPos ? '#00e676' : '#ff4081';

  // Total trades across window
  const totalTrades = merged.reduce((s, c) => s + (Number(c.trade_count) || 0), 0);

  return (
    <Box
      onClick={() => setSelected(isSelected ? null : pairKey)}
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: isSelected ? 'rgba(0,229,255,0.08)' : 'background.paper',
        border: `1px solid ${isSelected ? '#00e5ff' : 'rgba(255,255,255,0.08)'}`,
        cursor: 'pointer',
        transition: 'border-color 0.2s, background-color 0.2s',
        '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minWidth: 0,
      }}
    >
      {/* Header: pair name + % change */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'primary.main', fontFamily: 'JetBrains Mono', letterSpacing: 1 }}>
          {shortPair(pairKey)}
        </Typography>
        {pct != null && (
          <Typography sx={{ fontSize: '0.65rem', color, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>
            {pctPos ? '+' : ''}{pct.toFixed(2)}%
          </Typography>
        )}
      </Box>

      {/* Sparkline */}
      {isLoading && !liveCandles.length ? (
        <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
      ) : (
        <Box sx={{ height: 44, mx: -0.5 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={merged} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${pairKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip content={<SparkTooltip />} />
              <Area
                type="monotone"
                dataKey="close"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#grad-${pairKey})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      )}

      {/* Footer: last price + window volume in XRP */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', fontFamily: 'JetBrains Mono' }}>
          {last ? fmtPrice(last.close) : '—'} XRP
        </Typography>
        <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', fontFamily: 'JetBrains Mono' }}>
          {windowVolume != null ? `${fmtVolume(windowVolume)} XRP` : ''}{totalTrades ? ` · ${totalTrades}tx` : ''}
        </Typography>
      </Box>
    </Box>
  );
}
