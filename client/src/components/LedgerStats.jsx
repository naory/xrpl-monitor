import { Box, Typography, CircularProgress, Paper } from '@mui/material';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useLedgerStats }      from '../hooks/useLedgerStats';
import { useStats }            from '../hooks/useStats';
import { useAmmStats }         from '../hooks/useAmmStats';
import { useBridgeHistory }    from '../hooks/useBridgeHistory';
import { useXrpDemandHistory } from '../hooks/useXrpDemandHistory';
import { useEscrowHistory }    from '../hooks/useEscrowHistory';

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  const f = parseFloat(n);
  if (f >= 1e9)  return `${(f / 1e9).toFixed(decimals)}B`;
  if (f >= 1e6)  return `${(f / 1e6).toFixed(decimals)}M`;
  if (f >= 1000) return `${(f / 1000).toFixed(1)}K`;
  return f.toFixed(decimals);
}

const TYPE_COLORS = [
  '#00e5ff', '#7c4dff', '#00e676', '#ffab40',
  '#ff4081', '#64ffda', '#ea80fc', '#82b1ff',
  '#ccff90', '#ff6d00', '#b0bec5', '#f48fb1',
];

function StatCard({ label, value, sub, color = 'primary.main' }) {
  return (
    <Paper sx={{ p: 2, flex: 1, minWidth: 0, bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.06)' }}>
      <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontFamily: 'JetBrains Mono', letterSpacing: 1, textTransform: 'uppercase', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'JetBrains Mono', color, lineHeight: 1.1 }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontFamily: 'JetBrains Mono', mt: 0.25 }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

const MiniTooltip = ({ active, payload, label: xLabel, formatter }) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: 'background.default', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, px: 1, py: 0.5 }}>
      <Typography sx={{ fontFamily: 'JetBrains Mono', fontSize: '0.6rem', color: 'text.secondary' }}>
        {formatter ? formatter(payload[0].value) : payload[0].value}
      </Typography>
    </Box>
  );
};

function MiniKpi({ label, value, sub, color }) {
  return (
    <Paper sx={{ flex: 1, minWidth: 0, p: 1.5, bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.06)' }}>
      <Typography sx={{ fontSize: '0.55rem', color: 'text.disabled', fontFamily: 'JetBrains Mono', letterSpacing: 1, textTransform: 'uppercase', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, fontFamily: 'JetBrains Mono', color, lineHeight: 1.1 }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontSize: '0.55rem', color: 'text.disabled', fontFamily: 'JetBrains Mono', mt: 0.25 }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

function TabSummary({ window }) {
  const iouQuery    = useStats(window);
  const ammQuery    = useAmmStats(window);
  const bridgeQuery = useBridgeHistory(window);
  const xrpDemQuery = useXrpDemandHistory(window);
  const escTimQuery = useEscrowHistory('time_lock', window);
  const escIlpQuery = useEscrowHistory('ilp', window);

  const iouVol   = iouQuery.data?.volumeLeaderboard?.reduce((s, p) => s + (p.volume ?? 0), 0) ?? null;
  const iouPairs = iouQuery.data?.volumeLeaderboard?.length ?? null;

  const ammVol    = ammQuery.data?.pools?.reduce((s, p) => s + (p.volume ?? 0), 0) ?? null;
  const ammActive = ammQuery.data?.pools?.filter((p) => p.volume > 0).length ?? null;

  const bridgeSummary = bridgeQuery.data?.summary ?? {};
  const bridgeVol = Object.keys(bridgeSummary).length
    ? Object.values(bridgeSummary).reduce((s, v) => s + (v.fromVolume ?? 0), 0)
    : null;
  const bridgeTop = bridgeQuery.data?.topCurrencies?.[0] ?? null;

  const xrpSummary = xrpDemQuery.data?.summary ?? {};
  const xrpVals   = Object.values(xrpSummary);
  const xrpBought = xrpVals.length ? xrpVals.reduce((s, v) => s + (v.bought ?? 0), 0) : null;
  const xrpSold   = xrpVals.length ? xrpVals.reduce((s, v) => s + (v.sold   ?? 0), 0) : null;
  const xrpNet    = xrpBought != null ? xrpBought - xrpSold : null;

  const escTim = escTimQuery.data?.summary;
  const escIlp = escIlpQuery.data?.summary;

  const cards = [
    {
      label: 'IOU TRADES',
      value: iouVol   != null ? `${fmt(iouVol)} XRP`   : '—',
      sub:   iouPairs != null ? `${iouPairs} active pairs` : null,
      color: '#58a6ff',
    },
    {
      label: 'AMM',
      value: ammVol   != null ? `${fmt(ammVol)} XRP`   : '—',
      sub:   ammActive != null ? `${ammActive} active pools` : null,
      color: '#39d353',
    },
    {
      label: 'BRIDGE',
      value: bridgeVol != null ? `${fmt(bridgeVol)} XRP` : '—',
      sub:   bridgeTop  ? `top: ${bridgeTop}`            : null,
      color: '#ffa657',
    },
    {
      label: 'XRP DEMAND',
      value: xrpNet != null ? `${xrpNet >= 0 ? '+' : ''}${fmt(xrpNet)} XRP` : '—',
      sub:   xrpBought != null ? `${fmt(xrpBought)} bought / ${fmt(xrpSold)} sold` : null,
      color: xrpNet > 0 ? '#3fb950' : xrpNet < 0 ? '#f78166' : '#8b949e',
    },
    {
      label: 'ESCROW TIME',
      value: escTim?.successRate != null ? `${(escTim.successRate * 100).toFixed(1)}%` : '—',
      sub:   escTim ? `${escTim.creates + escTim.finishes + escTim.cancels} txs` : null,
      color: escTim?.successRate >= 0.7 ? '#3fb950' : '#ffa657',
    },
    {
      label: 'ESCROW ILP',
      value: escIlp?.successRate != null ? `${(escIlp.successRate * 100).toFixed(1)}%` : '—',
      sub:   escIlp ? `${escIlp.creates + escIlp.finishes + escIlp.cancels} txs` : null,
      color: escIlp?.successRate >= 0.7 ? '#3fb950' : '#ffa657',
    },
  ];

  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
      {cards.map(({ label, value, sub, color }) => (
        <MiniKpi key={label} label={label} value={value} sub={sub} color={color} />
      ))}
    </Box>
  );
}

export function LedgerStats({ window }) {
  const { data, isLoading, isError } = useLedgerStats(window);

  if (isLoading) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (isError) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography color="error.main" sx={{ fontSize: '0.8rem' }}>Failed to load ledger stats</Typography>
      </Box>
    );
  }

  const s = data?.summary;
  const series = data?.series ?? [];

  if (!s) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography color="text.secondary" sx={{ fontSize: '0.8rem' }}>Collecting data…</Typography>
      </Box>
    );
  }

  // Tx type breakdown sorted by count
  const txTypeData = Object.entries(s.txTypes || {})
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Shorten series for sparklines
  const sparkSeries = series.map((l, i) => ({ i, txnCount: l.txnCount, feeBurnXrp: l.feeBurnDrops / 1e6, closeTimeSec: l.closeTimeSec }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', overflow: 'auto' }}>

      {/* Stat cards row */}
      <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
        <StatCard
          label="TPS"
          value={s.tps.toFixed(2)}
          sub={`${s.ledgerCount} ledgers · last ${window}`}
          color="#00e5ff"
        />
        <StatCard
          label="Avg Close Time"
          value={s.avgCloseTimeSec != null ? `${s.avgCloseTimeSec.toFixed(2)}s` : '—'}
          sub="target ~3–4s"
          color={s.avgCloseTimeSec > 5 ? '#ff4081' : '#00e676'}
        />
        <StatCard
          label="Success Rate"
          value={s.successRate != null ? `${(s.successRate * 100).toFixed(1)}%` : '—'}
          sub={`${fmt(s.failedCount, 0)} failed · last ${window}`}
          color={s.successRate < 0.85 ? '#ff4081' : '#00e676'}
        />
        <StatCard
          label="Fee Burn"
          value={`${fmt(s.feeBurnXrp)} XRP`}
          sub={`destroyed · last ${window}`}
          color="#ffab40"
        />
        <StatCard
          label="Payment Vol"
          value={`${fmt(s.paymentXrp)} XRP`}
          sub={`via Payment txs · last ${window}`}
          color="#7c4dff"
        />
      </Box>

      {/* Tab KPI summary */}
      <TabSummary window={window} />

      {/* Middle row: tx type chart + sparklines */}
      <Box sx={{ display: 'flex', gap: 1.5, flex: 1, minHeight: 0 }}>

        {/* Tx type breakdown */}
        <Paper sx={{ flex: '0 0 340px', p: 2, bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' }}>
          <Typography sx={{ fontSize: '0.7rem', color: 'primary.main', fontFamily: 'JetBrains Mono', letterSpacing: 1.5, textTransform: 'uppercase', mb: 1.5 }}>
            Tx Type Breakdown
          </Typography>
          <Box sx={{ flex: 1 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={txTypeData} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category" dataKey="type" width={140}
                  tick={{ fill: '#9fa8da', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false} tickLine={false}
                />
                <Tooltip content={<MiniTooltip formatter={(v) => `${fmt(v, 0)} txs`} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {txTypeData.map((_, i) => (
                    <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Paper>

        {/* Time series sparklines */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>

          <Paper sx={{ flex: 1, p: 2, bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' }}>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontFamily: 'JetBrains Mono', letterSpacing: 1, textTransform: 'uppercase', mb: 1 }}>
              Txs / Ledger (recent)
            </Typography>
            <Box sx={{ flex: 1 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkSeries} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-txns" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00e5ff" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00e5ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip content={<MiniTooltip formatter={(v) => `${v} txs`} />} />
                  <Area type="monotone" dataKey="txnCount" stroke="#00e5ff" strokeWidth={1.5}
                    fill="url(#grad-txns)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Paper>

          <Paper sx={{ flex: 1, p: 2, bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' }}>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontFamily: 'JetBrains Mono', letterSpacing: 1, textTransform: 'uppercase', mb: 1 }}>
              Fee Burn / Ledger (XRP)
            </Typography>
            <Box sx={{ flex: 1 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkSeries} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-fee" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#ffab40" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ffab40" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip content={<MiniTooltip formatter={(v) => `${v.toFixed(4)} XRP`} />} />
                  <Area type="monotone" dataKey="feeBurnXrp" stroke="#ffab40" strokeWidth={1.5}
                    fill="url(#grad-fee)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Paper>

          <Paper sx={{ flex: 1, p: 2, bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' }}>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontFamily: 'JetBrains Mono', letterSpacing: 1, textTransform: 'uppercase', mb: 1 }}>
              Close Time / Ledger (s)
            </Typography>
            <Box sx={{ flex: 1 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkSeries} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-close" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00e676" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00e676" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={[0, 'auto']} />
                  <Tooltip content={<MiniTooltip formatter={(v) => `${v?.toFixed(2)}s`} />} />
                  <Area type="monotone" dataKey="closeTimeSec" stroke="#00e676" strokeWidth={1.5}
                    fill="url(#grad-close)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Paper>

        </Box>
      </Box>
    </Box>
  );
}
