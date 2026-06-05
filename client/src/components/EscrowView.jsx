import { Box, Typography } from '@mui/material';
import { useEscrowStream }  from '../hooks/useEscrowStream';
import { useEscrowHistory } from '../hooks/useEscrowHistory';

const CHART_W = 420, CHART_H = 56, CHART_PAD_B = 14;
const TTF_LABELS = ['<5s', '<30s', '<5m', '<1h', '<1d', '≥1d'];
const TTF_COLORS = ['#3fb950', '#56d364', '#ffa657', '#f78166', '#ff7b72', '#8b949e'];
const WINDOWS_MS = { '10m': 10 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 };

function fmt(n, decimals = 0) {
  if (n == null || n === 0) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function fmtXrp(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M XRP`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K XRP`;
  return `${n.toFixed(0)} XRP`;
}

function fmtAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function StackedBarChart({ series }) {
  const maxVal = Math.max(1, ...series.map((s) => s.finishes + s.cancels));
  const barW   = CHART_W / Math.max(series.length, 1);
  const chartH = CHART_H - CHART_PAD_B;
  return (
    <svg width={CHART_W} height={CHART_H} style={{ display: 'block' }}>
      {series.map((s, i) => {
        const total   = s.finishes + s.cancels;
        const totalH  = Math.round((total / maxVal) * chartH);
        const finishH = total > 0 ? Math.round((s.finishes / total) * totalH) : 0;
        const cancelH = totalH - finishH;
        const x = i * barW;
        return (
          <g key={i}>
            {cancelH > 0 && <rect x={x} y={chartH - totalH} width={Math.max(1, barW - 1)} height={cancelH} fill="#f78166" opacity={0.8} />}
            {finishH > 0 && <rect x={x} y={chartH - finishH} width={Math.max(1, barW - 1)} height={finishH} fill="#3fb950" opacity={0.8} />}
          </g>
        );
      })}
      <line x1={0} y1={chartH} x2={CHART_W} y2={chartH} stroke="#30363d" strokeWidth={1} />
    </svg>
  );
}

function TtfHistogram({ ttfBuckets }) {
  const vals   = [ttfBuckets.lt5s, ttfBuckets.lt30s, ttfBuckets.lt5m, ttfBuckets.lt1h, ttfBuckets.lt1d, ttfBuckets.gte1d];
  const maxVal = Math.max(1, ...vals);
  const barW   = 200 / 6;
  const chartH = 44;
  return (
    <svg width={200} height={chartH + 14} style={{ display: 'block' }}>
      {vals.map((v, i) => {
        const h = Math.max(v > 0 ? 2 : 0, Math.round((v / maxVal) * chartH));
        return (
          <g key={i}>
            <rect x={i * barW + 1} y={chartH - h} width={Math.max(1, barW - 2)} height={h} fill={TTF_COLORS[i]} opacity={0.85} />
            <text x={i * barW + barW / 2} y={chartH + 11} textAnchor="middle" fill="#484f58" fontSize={7}>{TTF_LABELS[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function EscrowView({ type, window = 'live' }) {
  const isLive = window === 'live';

  const { recentEvents, stats: streamStats } = useEscrowStream(type);
  const historyQuery = useEscrowHistory(isLive ? null : type, isLive ? null : window);
  const histData     = historyQuery.data;

  const summary = isLive ? null : histData?.summary;
  const series  = isLive ? []   : (histData?.series ?? []);

  const successRate    = isLive ? streamStats.successRate    : summary?.successRate;
  const medianTtf      = isLive ? null                       : summary?.medianTtfLabel;
  const totalCount     = isLive
    ? streamStats.creates + streamStats.finishes + streamStats.cancels
    : (summary ? summary.creates + summary.finishes + summary.cancels : 0);
  const xrpVolume      = isLive ? streamStats.xrpVolume      : summary?.xrpCreated ?? 0;
  const ttfBuckets     = isLive ? null                       : summary?.ttfBuckets;

  const label = type === 'ilp' ? 'ILP / HTLC' : 'Time-lock';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 2, minWidth: 460, overflow: 'auto' }}>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5, letterSpacing: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>
        Escrow — {label} · {isLive ? 'Live' : `Last ${window}`}
      </Typography>

      {/* KPI cards */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, width: '100%', maxWidth: 420 }}>
        {[
          { label: 'SUCCESS RATE', value: successRate != null ? `${(successRate * 100).toFixed(1)}%` : '—', color: successRate != null ? (successRate >= 0.7 ? '#3fb950' : '#ffa657') : 'text.secondary' },
          { label: 'MEDIAN TTF',   value: medianTtf ?? '—',                                              color: 'text.primary' },
          { label: 'COUNT',        value: fmt(totalCount),                                                color: 'text.primary' },
          { label: 'VOLUME',       value: fmtXrp(xrpVolume),                                             color: '#58a6ff' },
        ].map(({ label: l, value, color }) => (
          <Box key={l} sx={{ flex: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', letterSpacing: 0.5, mb: 0.25 }}>{l}</Typography>
            <Typography sx={{ fontSize: '1rem', fontWeight: 700, color, lineHeight: 1.2 }}>{value}</Typography>
          </Box>
        ))}
      </Box>

      {/* Stacked finish/cancel chart (historical only) */}
      {!isLive && (
        <Box sx={{ mb: 1.5, width: CHART_W }}>
          <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', letterSpacing: 0.5, mb: 0.5 }}>
            FINISH <span style={{ color: '#3fb950' }}>■</span> &nbsp; CANCEL <span style={{ color: '#f78166' }}>■</span>
          </Typography>
          <StackedBarChart series={series} />
        </Box>
      )}

      {/* Bottom row: TTF histogram + live feed */}
      <Box sx={{ display: 'flex', gap: 2, width: '100%', maxWidth: 420 }}>
        {/* TTF histogram (historical only) */}
        {!isLive && ttfBuckets && (
          <Box sx={{ flex: '0 0 auto' }}>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', letterSpacing: 0.5, mb: 0.5 }}>TTF DISTRIBUTION</Typography>
            <TtfHistogram ttfBuckets={ttfBuckets} />
          </Box>
        )}

        {/* Live event feed */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', letterSpacing: 0.5, mb: 0.5 }}>RECENT EVENTS</Typography>
          {recentEvents.length === 0 && (
            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>Waiting for escrow events…</Typography>
          )}
          {recentEvents.map((e, i) => {
            const isFinish = e.txType === 'EscrowFinish';
            const isCancel = e.txType === 'EscrowCancel';
            const color    = isFinish ? '#3fb950' : isCancel ? '#f78166' : '#8b949e';
            const label2   = isFinish ? 'FINISH' : isCancel ? 'CANCEL' : 'CREATE';
            const ttf      = e.ttfMs != null ? ` ${(e.ttfMs / 1000).toFixed(1)}s` : '';
            const amount   = e.amountXrp ? ` ${parseFloat(e.amountXrp).toFixed(0)} XRP` : '';
            const addr     = e.owner ? fmtAddr(e.owner) : fmtAddr(e.destination);
            return (
              <Box key={`${e.txHash}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography sx={{ fontSize: '0.65rem', color, fontWeight: 700, minWidth: 44 }}>{label2}</Typography>
                {amount && <Typography sx={{ fontSize: '0.65rem', color: 'text.primary' }}>{amount}</Typography>}
                {ttf    && <Typography sx={{ fontSize: '0.65rem', color: '#58a6ff' }}>{ttf}</Typography>}
                <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', ml: 'auto' }}>{addr}</Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
