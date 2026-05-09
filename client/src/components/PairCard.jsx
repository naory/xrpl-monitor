import { Box, Typography, Skeleton } from '@mui/material';
import {
  AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip,
} from 'recharts';
import { useOhlcv } from '../hooks/useOhlcv';
import { useWsStore } from '../store/useWsStore';
import { tokenLabel } from '../utils/pairs';

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

const PriceTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Box sx={{ bgcolor: 'background.default', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, px: 1, py: 0.5 }}>
      <Typography sx={{ fontFamily: 'JetBrains Mono', fontSize: '0.6rem', color: 'text.secondary' }}>
        O {fmtPrice(d.open)}  H {fmtPrice(d.high)}<br />
        L {fmtPrice(d.low)}   C {fmtPrice(d.close)}
      </Typography>
    </Box>
  );
};

const MiniTooltip = ({ active, payload, formatter }) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: 'background.default', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, px: 1, py: 0.5 }}>
      <Typography sx={{ fontFamily: 'JetBrains Mono', fontSize: '0.6rem', color: 'text.secondary' }}>
        {formatter(payload[0].value)}
      </Typography>
    </Box>
  );
};

function ChartRow({ label, children }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mx: -0.5 }}>
      <Typography sx={{ fontSize: '0.5rem', color: 'text.disabled', fontFamily: 'JetBrains Mono', letterSpacing: 0.5, writingMode: 'vertical-rl', transform: 'rotate(180deg)', userSelect: 'none', width: 10, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, height: 36 }}>
        {children}
      </Box>
    </Box>
  );
}

export function PairCard({ pairKey, window, windowVolume, issuerCount = 1 }) {
  const { data: candles, isLoading } = useOhlcv(pairKey, { window });
  const liveBuckets  = useWsStore((s) => s.liveBuckets[pairKey]);
  const setSelected  = useWsStore((s) => s.setSelectedPair);
  const selectedPair = useWsStore((s) => s.selectedPair);
  const isSelected   = selectedPair === pairKey;

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

  // Invert OHLC: display "token per XRP" rather than "XRP per token".
  // Inversion flips high↔low since 1/small > 1/large.
  const inv = (v) => (v && v !== 0 ? 1 / v : null);
  const invertCandle = (c) => ({ ...c, open: inv(c.open), high: inv(c.low), low: inv(c.high), close: inv(c.close) });

  const merged = [
    ...serverCandles.filter((c) => !liveKeys.has(c.bucket_time)),
    ...liveCandles,
  ].slice(-120).map(invertCandle);

  const last  = merged[merged.length - 1];
  const first = merged[0];
  const pct   = last && first && first.open
    ? ((last.close - first.open) / Math.abs(first.open)) * 100
    : null;
  const pctPos = pct != null && pct >= 0;
  const priceColor = pctPos ? '#00e676' : '#ff4081';

  const totalTrades = merged.reduce((s, c) => s + (Number(c.trade_count) || 0), 0);
  const quoteLabel  = tokenLabel(pairKey).split('/')[0];

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
        gap: 0.75,
        minWidth: 0,
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'primary.main', fontFamily: 'JetBrains Mono', letterSpacing: 1 }}>
            {tokenLabel(pairKey)}
          </Typography>
          {issuerCount > 1 && (
            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontFamily: 'JetBrains Mono' }}>
              ×{issuerCount}
            </Typography>
          )}
        </Box>
        {pct != null && (
          <Typography sx={{ fontSize: '0.65rem', color: priceColor, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>
            {pctPos ? '+' : ''}{pct.toFixed(2)}%
          </Typography>
        )}
      </Box>

      {isLoading && !liveCandles.length ? (
        <>
          <Skeleton variant="rectangular" height={36} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" height={36} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" height={36} sx={{ borderRadius: 1 }} />
        </>
      ) : (
        <>
          {/* Price chart */}
          <ChartRow label="PRICE">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={merged} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`gp-${pairKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={priceColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={priceColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip content={<PriceTooltip />} />
                <Area type="monotone" dataKey="close" stroke={priceColor} strokeWidth={1.5}
                  fill={`url(#gp-${pairKey})`} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartRow>

          {/* Volume chart */}
          <ChartRow label="VOL">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={merged} margin={{ top: 1, right: 0, left: 0, bottom: 0 }} barCategoryGap="15%">
                <Tooltip content={<MiniTooltip formatter={(v) => `${fmtVolume(v)} XRP`} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="volume" fill="#7c4dff" opacity={0.8} isAnimationActive={false} radius={[1, 1, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartRow>

          {/* Trade count chart */}
          <ChartRow label="TXS">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={merged} margin={{ top: 1, right: 0, left: 0, bottom: 0 }} barCategoryGap="15%">
                <Tooltip content={<MiniTooltip formatter={(v) => `${v} txs`} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="trade_count" fill="#ffab40" opacity={0.8} isAnimationActive={false} radius={[1, 1, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartRow>
        </>
      )}

      {/* Footer */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', fontFamily: 'JetBrains Mono' }}>
          {last ? fmtPrice(last.close) : '—'} {quoteLabel}
        </Typography>
        <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', fontFamily: 'JetBrains Mono' }}>
          {windowVolume != null ? `${fmtVolume(windowVolume)} XRP` : ''}{totalTrades ? ` · ${totalTrades}tx` : ''}
        </Typography>
      </Box>
    </Box>
  );
}
