import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useXrpDemandStream } from '../hooks/useXrpDemandStream';
import { useXrpDemandHistory } from '../hooks/useXrpDemandHistory';

const CX = 240, CY = 240, RING_R = 170, NS = 'http://www.w3.org/2000/svg';
const MAX_RING = 12;
const ANIM_DUR = 520;

const KNOWN_COLORS = {
  USD: '#3fb950', EUR: '#58a6ff', BTC: '#f78166', ETH: '#a371f7',
  USDC: '#39d353', GBP: '#ffa657', SOL: '#79c0ff', JPY: '#ff7b72',
  XLM: '#e6edf3', ADA: '#c9d1d9', DOT: '#b1bac4', LINK: '#8b949e',
};
const FALLBACK = ['#d2a8ff', '#ffa657', '#79c0ff', '#56d364', '#f78166', '#58a6ff'];
const EMPTY_STATS = {};

function colorFor(id, orderedList) {
  if (KNOWN_COLORS[id]) return KNOWN_COLORS[id];
  return FALLBACK[orderedList.indexOf(id) % FALLBACK.length] ?? '#8b949e';
}

function ringPositions(currencies) {
  return currencies.map((id, i) => {
    const angle = (i / currencies.length) * 2 * Math.PI - Math.PI / 2;
    return { id, x: CX + RING_R * Math.cos(angle), y: CY + RING_R * Math.sin(angle) };
  });
}

function animateLeg(svgEl, x1, y1, x2, y2, color, isCancelled) {
  return new Promise((resolve, reject) => {
    const qx = (x1 * 0.55 + x2 * 0.45);
    const qy = (y1 * 0.55 + y2 * 0.45) - 18;

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', `M${x1},${y1} Q${qx},${qy} ${x2},${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'none');
    svgEl.appendChild(path);

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', 5);
    dot.setAttribute('fill', color);
    dot.style.filter = `drop-shadow(0 0 5px ${color})`;
    svgEl.querySelector('#xd-particles').appendChild(dot);

    const len   = path.getTotalLength();
    const start = performance.now();

    function tick(now) {
      if (isCancelled()) {
        svgEl.querySelector('#xd-particles')?.removeChild(dot);
        if (path.parentNode) svgEl.removeChild(path);
        return reject(new Error('cancelled'));
      }
      const t = Math.min((now - start) / ANIM_DUR, 1);
      const pt = path.getPointAtLength(t * len);
      dot.setAttribute('cx', pt.x);
      dot.setAttribute('cy', pt.y);
      dot.style.opacity = Math.sin(t * Math.PI);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        svgEl.querySelector('#xd-particles')?.removeChild(dot);
        if (path.parentNode) svgEl.removeChild(path);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

const CHART_W = 420, CHART_H = 72, CHART_PAD_B = 16;
const OTHER_COLOR = '#444e5a';

function DemandSparkline({ series, topCurrencies, ringCurrencies }) {
  if (!series?.length || !topCurrencies?.length) return null;

  const allKeys = [...topCurrencies, 'other'];
  const maxBucketTotal = Math.max(
    1,
    ...series.map((b) => allKeys.reduce((s, k) => s + (b.currencies[k] ?? 0), 0))
  );

  const barW   = Math.floor((CHART_W - 2) / series.length);
  const chartH = CHART_H - CHART_PAD_B;

  return (
    <svg width={CHART_W} height={CHART_H} style={{ display: 'block' }}>
      {series.map((bucket, i) => {
        const total = allKeys.reduce((s, k) => s + (bucket.currencies[k] ?? 0), 0);
        if (total === 0) return null;
        let yOffset = chartH;
        const x = i * barW + 1;
        return (
          <g key={bucket.ts}>
            {allKeys.map((k) => {
              const val = bucket.currencies[k] ?? 0;
              if (val === 0) return null;
              const h = Math.max(1, Math.round((val / maxBucketTotal) * chartH));
              yOffset -= h;
              return (
                <rect
                  key={k}
                  x={x} y={yOffset} width={Math.max(1, barW - 1)} height={h}
                  fill={k === 'other' ? OTHER_COLOR : colorFor(k, ringCurrencies)}
                  opacity={0.8}
                />
              );
            })}
          </g>
        );
      })}
      <line x1={0} y1={chartH} x2={CHART_W} y2={chartH} stroke="#30363d" strokeWidth={1} />
    </svg>
  );
}

export function XrpDemandView() {
  const { queue, setQueue, stats } = useXrpDemandStream();
  const svgRef = useRef(null);
  const [animating, setAnimating] = useState(false);
  const [ringCurrencies, setRingCurrencies] = useState([]);
  const [viewWindow, setViewWindow] = useState('live');

  const isLive = viewWindow === 'live';
  const historyQuery = useXrpDemandHistory(isLive ? null : viewWindow);
  const historyData  = historyQuery.data;

  const activeStats = isLive ? stats : (historyData?.summary ?? EMPTY_STATS);

  useEffect(() => {
    setRingCurrencies((prev) => {
      const incoming = Object.keys(activeStats).filter((c) => !prev.includes(c));
      if (!incoming.length) return prev;
      return [...prev, ...incoming].slice(0, MAX_RING);
    });
  }, [activeStats]);

  const positions = useMemo(() => ringPositions(ringCurrencies), [ringCurrencies]);
  const maxVol = positions.reduce((m, p) => {
    const s = activeStats[p.id];
    return Math.max(m, s?.bought ?? 0, s?.sold ?? 0);
  }, 1);

  useEffect(() => {
    if (animating || queue.length === 0 || !svgRef.current) return;

    const [next, ...rest] = queue;
    setQueue(rest);
    setAnimating(true);

    const currPos = positions.find((p) => p.id === next.currency);
    if (!currPos) {
      setAnimating(false);
      return;
    }

    const color = colorFor(currPos.id, ringCurrencies);
    // buy: currency → XRP center; sell: XRP center → currency
    const [x1, y1, x2, y2] = next.direction === 'buy'
      ? [currPos.x, currPos.y, CX, CY]
      : [CX, CY, currPos.x, currPos.y];

    let cancelled = false;
    animateLeg(svgRef.current, x1, y1, x2, y2, color, () => cancelled)
      .then(() => { if (!cancelled) setAnimating(false); })
      .catch(() => setAnimating(false));

    return () => { cancelled = true; };
  }, [queue, animating, positions, ringCurrencies]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedStats = Object.entries(activeStats)
    .sort((a, b) => (b[1].bought + b[1].sold) - (a[1].bought + a[1].sold));

  const fmt = (n) => (n != null && Math.abs(n) > 0)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : '—';
  const fmtBalance = (n) => {
    if (n == null || n === 0) return '—';
    const s = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
    return n > 0 ? `+${s}` : `-${s}`;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 2, height: '100%', overflow: 'auto' }}>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2, letterSpacing: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>
        Direct XRP Demand — {viewWindow === 'live' ? 'Live' : `Last ${viewWindow}`}
      </Typography>

      <svg ref={svgRef} viewBox="0 0 480 480" style={{ width: 420, height: 420, flexShrink: 0 }}>
        <defs>
          <radialGradient id="xdGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00a6cc" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#00a6cc" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={CX} cy={CY} r={65} fill="url(#xdGlow)" />
        <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="#21262d" strokeWidth={1} strokeDasharray="4 6" />

        {/* Weighted edges: solid = buy (currency→XRP), dashed = sell (XRP→currency) */}
        <g id="xd-edges">
          {positions.map((p) => {
            const s = activeStats[p.id];
            if (!s) return null;
            const color = colorFor(p.id, ringCurrencies);
            const dx = CX - p.x, dy = CY - p.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const px = -dy / len, py = dx / len;
            const mx = (p.x + CX) / 2, my = (p.y + CY) / 2;
            const O = 28;
            const buyW  = s.bought > 0 ? Math.max(0.8, (s.bought / maxVol) * 6) : 0;
            const sellW = s.sold   > 0 ? Math.max(0.8, (s.sold   / maxVol) * 6) : 0;
            return (
              <g key={p.id}>
                {buyW > 0 && (
                  <path d={`M${p.x},${p.y} Q${mx + px * O},${my + py * O} ${CX},${CY}`}
                    fill="none" stroke={color} strokeWidth={buyW} opacity={0.45} />
                )}
                {sellW > 0 && (
                  <path d={`M${CX},${CY} Q${mx - px * O},${my - py * O} ${p.x},${p.y}`}
                    fill="none" stroke={color} strokeWidth={sellW} opacity={0.25}
                    strokeDasharray="4 3" />
                )}
              </g>
            );
          })}
        </g>

        <g id="xd-particles" />

        {positions.map((p) => {
          const color = colorFor(p.id, ringCurrencies);
          return (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r={26} fill="#161b22" stroke={color + '66'} strokeWidth={1.5} />
              <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
                fill={color} fontSize={11} fontWeight={600} style={{ pointerEvents: 'none' }}>
                {p.id}
              </text>
            </g>
          );
        })}

        {ringCurrencies.length === 0 && (
          <text x={CX} y={CY + 80} textAnchor="middle" fill="#7d8590" fontSize={12}>
            Waiting for XRP demand events…
          </text>
        )}

        {/* XRP center node */}
        <circle cx={CX} cy={CY} r={32} fill="#1c2128" stroke="#00a6cc" strokeWidth={2.5}
          style={{ filter: 'drop-shadow(0 0 8px rgba(0,166,204,0.4))', transition: 'filter 0.15s' }} />
        <text x={CX} y={CY - 3} textAnchor="middle" dominantBaseline="middle"
          fill="#00a6cc" fontSize={13} fontWeight={700}>XRP</text>
        <text x={CX} y={CY + 13} textAnchor="middle" dominantBaseline="middle"
          fill="#4d9ab5" fontSize={9} fontWeight={500}>direct</text>
      </svg>

      {/* Window selector */}
      <ToggleButtonGroup
        value={viewWindow}
        exclusive
        onChange={(_, v) => {
          if (v) {
            setViewWindow(v);
            setRingCurrencies([]);
            setQueue([]);
          }
        }}
        size="small"
        sx={{ mb: 2, mt: 1 }}
      >
        {['live', '10m', '1h', '24h'].map((w) => (
          <ToggleButton key={w} value={w} sx={{ px: 2, fontSize: '0.7rem', textTransform: 'uppercase' }}>
            {w}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {/* Sparkline — historical mode only */}
      {!isLive && historyData && (
        <Box sx={{ mb: 2 }}>
          <DemandSparkline
            series={historyData.series}
            topCurrencies={historyData.topCurrencies}
            ringCurrencies={ringCurrencies}
          />
        </Box>
      )}

      {/* Stats table */}
      {sortedStats.length > 0 && (
        <Box sx={{
          width: 420, mt: 2,
          border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden',
        }}>
          <Box sx={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 50px',
            px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
          }}>
            {['Pair', 'XRP Bought', 'XRP Sold', 'Balance', 'Count'].map((h) => (
              <Typography key={h} variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontSize: '0.6rem' }}>
                {h}
              </Typography>
            ))}
          </Box>
          {sortedStats.map(([id, v]) => {
            const color = colorFor(id, ringCurrencies);
            const balanceColor = v.balance > 0 ? 'success.main' : v.balance < 0 ? 'error.main' : 'text.secondary';
            return (
              <Box key={id} sx={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 50px',
                alignItems: 'center', px: 2, py: 0.8,
                borderBottom: '1px solid', borderColor: 'divider',
                '&:last-child': { borderBottom: 'none' },
                '&:hover': { bgcolor: 'action.hover' },
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>XRP/{id}</Typography>
                </Box>
                <Typography variant="body2" sx={{ color: 'success.main', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                  {fmt(v.bought)}
                </Typography>
                <Typography variant="body2" sx={{ color: 'error.main', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                  {fmt(v.sold)}
                </Typography>
                <Typography variant="body2" sx={{ color: balanceColor, fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                  {fmtBalance(v.balance)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'right' }}>
                  {v.count}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
