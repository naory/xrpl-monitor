// client/src/components/BridgeView.jsx
import { useEffect, useRef, useState } from 'react';
import { Box, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useBridgeStream } from '../hooks/useBridgeStream';
import { useBridgeHistory } from '../hooks/useBridgeHistory';

const CX = 240, CY = 240, RING_R = 170, NS = 'http://www.w3.org/2000/svg';
const MAX_RING = 12;
const ANIM_DUR = 520; // ms per leg

const KNOWN_COLORS = {
  USD: '#3fb950', EUR: '#58a6ff', BTC: '#f78166', ETH: '#a371f7',
  USDC: '#39d353', GBP: '#ffa657', SOL: '#79c0ff', JPY: '#ff7b72',
  XLM: '#e6edf3', ADA: '#c9d1d9', DOT: '#b1bac4', LINK: '#8b949e',
};
const FALLBACK = ['#d2a8ff','#ffa657','#79c0ff','#56d364','#f78166','#58a6ff'];

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

function animateLeg(svgEl, x1, y1, x2, y2, color, delay, isCancelled) {
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
    svgEl.querySelector('#particles').appendChild(dot);

    const len = path.getTotalLength();
    const start = performance.now() + delay;

    function tick(now) {
      if (isCancelled()) {
        svgEl.querySelector('#particles')?.removeChild(dot);
        if (path.parentNode) svgEl.removeChild(path);
        return reject(new Error('cancelled'));
      }
      if (now < start) { requestAnimationFrame(tick); return; }
      const t = Math.min((now - start) / ANIM_DUR, 1);
      const pt = path.getPointAtLength(t * len);
      dot.setAttribute('cx', pt.x);
      dot.setAttribute('cy', pt.y);
      dot.style.opacity = Math.sin(t * Math.PI);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        svgEl.querySelector('#particles')?.removeChild(dot);
        svgEl.removeChild(path);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

function flashArc(arcsEl, x1, y1, x2, y2, color) {
  const qx = (x1 * 0.55 + x2 * 0.45);
  const qy = (y1 * 0.55 + y2 * 0.45) - 18;
  const arc = document.createElementNS(NS, 'path');
  arc.setAttribute('d', `M${x1},${y1} Q${qx},${qy} ${x2},${y2}`);
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', color);
  arc.setAttribute('stroke-width', '1.5');
  arc.style.opacity = '0.18';
  arcsEl.appendChild(arc);
  setTimeout(() => { if (arc.parentNode) arcsEl.removeChild(arc); }, 2000);
}

const CHART_W = 420, CHART_H = 72, CHART_PAD_B = 16;
const OTHER_COLOR = '#444e5a';

function BridgeSparkline({ series, topCurrencies, ringCurrencies, onSeek }) {
  if (!series?.length || !topCurrencies?.length) return null;

  const allKeys = [...topCurrencies, 'other'];
  const maxBucketTotal = Math.max(
    1,
    ...series.map((b) => allKeys.reduce((s, k) => s + (b.currencies[k] ?? 0), 0))
  );

  const barW   = Math.floor((CHART_W - 2) / series.length);
  const chartH = CHART_H - CHART_PAD_B;

  return (
    <svg width={CHART_W} height={CHART_H} style={{ display: 'block', cursor: 'pointer' }}>
      {series.map((bucket, i) => {
        const total = allKeys.reduce((s, k) => s + (bucket.currencies[k] ?? 0), 0);
        if (total === 0) return null;
        let yOffset = chartH;
        const x = i * barW + 1;

        return (
          <g key={bucket.ts} onClick={() => onSeek?.(bucket.ts)}>
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
      {/* x-axis baseline */}
      <line x1={0} y1={chartH} x2={CHART_W} y2={chartH} stroke="#30363d" strokeWidth={1} />
    </svg>
  );
}

export function BridgeView() {
  const { queue, setQueue, stats } = useBridgeStream();
  const svgRef      = useRef(null);
  const [animating, setAnimating] = useState(false);
  const [ringCurrencies, setRingCurrencies] = useState([]);

  const [viewWindow, setViewWindow] = useState('live');

  const [playing, setPlaying]     = useState(false);
  const [speed,   setSpeed]       = useState(10);   // multiplier: 1 | 10 | 50
  const replayRef                 = useRef(null);
  const replayIdxRef              = useRef(0);
  const replayEventsRef           = useRef([]);

  const isLive = viewWindow === 'live';
  const historyQuery = useBridgeHistory(isLive ? null : viewWindow);
  const historyData  = historyQuery.data;

  const activeStats = isLive ? stats : (historyData?.summary ?? {});

  function stopReplay() {
    clearInterval(replayRef.current);
    replayRef.current = null;
    setPlaying(false);
  }

  function startReplay(events, fromIdx, speedMultiplier) {
    clearInterval(replayRef.current);
    replayEventsRef.current = events;
    replayIdxRef.current    = fromIdx;
    setPlaying(true);

    const TICK_MS   = 200;
    const REPLAY_MS = TICK_MS * speedMultiplier;

    if (!events.length) { setPlaying(false); return; }

    const t0Events    = new Date(events[fromIdx]?.ledgerTime).getTime();
    let replayElapsed = 0;

    replayRef.current = setInterval(() => {
      replayElapsed += REPLAY_MS;
      const cursor = t0Events + replayElapsed;
      const evs    = replayEventsRef.current;
      let idx      = replayIdxRef.current;
      const batch  = [];

      while (idx < evs.length && new Date(evs[idx].ledgerTime).getTime() <= cursor) {
        batch.push(evs[idx++]);
      }
      replayIdxRef.current = idx;

      if (batch.length) setQueue((q) => [...q, ...batch]);

      if (idx >= evs.length) {
        clearInterval(replayRef.current);
        replayRef.current = null;
        setPlaying(false);
      }
    }, TICK_MS);
  }

  function seekReplay(ts) {
    if (!historyData?.events?.length) return;
    const events  = historyData.events;
    const idx     = events.findIndex((ev) => new Date(ev.ledgerTime).getTime() >= ts);
    const fromIdx = idx === -1 ? events.length - 1 : idx;
    if (playing) {
      startReplay(events, fromIdx, speed);
    } else {
      replayIdxRef.current    = fromIdx;
      replayEventsRef.current = events;
    }
  }

  function handleSparklineSeek(ts) {
    seekReplay(ts);
  }

  // Grow the ring as new currencies appear in activeStats
  useEffect(() => {
    setRingCurrencies((prev) => {
      const incoming = Object.keys(activeStats).filter((c) => !prev.includes(c));
      if (!incoming.length) return prev;
      return [...prev, ...incoming].slice(0, MAX_RING);
    });
  }, [activeStats]);

  useEffect(() => () => clearInterval(replayRef.current), []);

  const positions = ringPositions(ringCurrencies);
  const maxVol = positions.reduce((m, p) => {
    const s = activeStats[p.id];
    return Math.max(m, s?.fromVolume ?? 0, s?.toVolume ?? 0);
  }, 1);

  // Animation queue processor
  useEffect(() => {
    if (animating || queue.length === 0 || !svgRef.current) return;

    const [next, ...rest] = queue;
    setQueue(rest);
    setAnimating(true);

    const from = positions.find((p) => p.id === next.fromCurrency);
    const to   = positions.find((p) => p.id === next.toCurrency);

    if (!from || !to) {
      setQueue((q) => [next, ...q]);
      setAnimating(false);
      return;
    }

    const fromColor = colorFor(from.id, ringCurrencies);
    const toColor   = colorFor(to.id,   ringCurrencies);
    const arcsEl    = svgRef.current.querySelector('#arcs');
    const xrpCircle = svgRef.current.querySelector('#xrp-circle');
    let cancelled   = false;

    flashArc(arcsEl, from.x, from.y, CX, CY, fromColor);
    flashArc(arcsEl, CX, CY, to.x, to.y, toColor);

    animateLeg(svgRef.current, from.x, from.y, CX, CY, fromColor, 0, () => cancelled)
      .then(() => {
        if (cancelled) return Promise.reject(new Error('cancelled'));
        if (xrpCircle) {
          xrpCircle.style.filter = 'drop-shadow(0 0 18px rgba(0,166,204,0.95))';
          setTimeout(() => {
            if (!cancelled && xrpCircle) xrpCircle.style.filter = 'drop-shadow(0 0 8px rgba(0,166,204,0.4))';
          }, 180);
        }
        if (!svgRef.current) return Promise.reject(new Error('cancelled'));
        return animateLeg(svgRef.current, CX, CY, to.x, to.y, toColor, 40, () => cancelled);
      })
      .then(() => { if (!cancelled) setAnimating(false); })
      .catch(() => setAnimating(false));

    return () => { cancelled = true; };
  }, [queue, animating, positions, ringCurrencies]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedStats = Object.entries(activeStats)
    .sort((a, b) => (b[1].fromVolume + b[1].toVolume) - (a[1].fromVolume + a[1].toVolume));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 2, height: '100%', overflow: 'auto' }}>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2, letterSpacing: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>
        XRP Bridge Utility — {viewWindow === 'live' ? 'Live' : `Last ${viewWindow}`}
      </Typography>

      <svg ref={svgRef} viewBox="0 0 480 480" style={{ width: 420, height: 420, flexShrink: 0 }}>
        <defs>
          <radialGradient id="xrpGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00a6cc" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#00a6cc" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* XRP center glow */}
        <circle cx={CX} cy={CY} r={65} fill="url(#xrpGlow)" />

        {/* Ring guide */}
        <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="#21262d" strokeWidth={1} strokeDasharray="4 6" />

        {/* Weighted persistent edges */}
        <g id="edges">
          {positions.map((p) => {
            const s = activeStats[p.id];
            if (!s) return null;
            const color = colorFor(p.id, ringCurrencies);
            const dx = CX - p.x, dy = CY - p.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const px = -dy / len, py = dx / len;
            const mx = (p.x + CX) / 2, my = (p.y + CY) / 2;
            const O = 28;
            const sellW = s.fromVolume > 0 ? Math.max(0.8, (s.fromVolume / maxVol) * 6) : 0;
            const buyW  = s.toVolume   > 0 ? Math.max(0.8, (s.toVolume   / maxVol) * 6) : 0;
            return (
              <g key={p.id}>
                {sellW > 0 && (
                  <path d={`M${p.x},${p.y} Q${mx + px * O},${my + py * O} ${CX},${CY}`}
                    fill="none" stroke={color} strokeWidth={sellW} opacity={0.45} />
                )}
                {buyW > 0 && (
                  <path d={`M${CX},${CY} Q${mx - px * O},${my - py * O} ${p.x},${p.y}`}
                    fill="none" stroke={color} strokeWidth={buyW} opacity={0.25}
                    strokeDasharray="4 3" />
                )}
              </g>
            );
          })}
        </g>

        {/* Faint arc flashes */}
        <g id="arcs" />

        {/* Animated particles */}
        <g id="particles" />

        {/* Currency nodes */}
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

        {/* Empty state hint */}
        {ringCurrencies.length === 0 && (
          <text x={CX} y={CY + 80} textAnchor="middle" fill="#7d8590" fontSize={12}>
            Waiting for bridge events…
          </text>
        )}

        {/* XRP center node */}
        <circle id="xrp-circle" cx={CX} cy={CY} r={32} fill="#1c2128" stroke="#00a6cc" strokeWidth={2.5}
          style={{ filter: 'drop-shadow(0 0 8px rgba(0,166,204,0.4))', transition: 'filter 0.15s' }} />
        <text x={CX} y={CY - 3} textAnchor="middle" dominantBaseline="middle"
          fill="#00a6cc" fontSize={13} fontWeight={700}>XRP</text>
        <text x={CX} y={CY + 13} textAnchor="middle" dominantBaseline="middle"
          fill="#4d9ab5" fontSize={9} fontWeight={500}>bridge</text>
      </svg>

      {/* Window selector */}
      <ToggleButtonGroup
        value={viewWindow}
        exclusive
        onChange={(_, v) => {
          if (v) {
            stopReplay();
            setViewWindow(v);
            setRingCurrencies([]);
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
          <BridgeSparkline
            series={historyData.series}
            topCurrencies={historyData.topCurrencies}
            ringCurrencies={ringCurrencies}
            onSeek={handleSparklineSeek}
          />
        </Box>
      )}

      {/* Replay controls — historical mode only */}
      {!isLive && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box
            component="button"
            onClick={() => {
              if (playing) {
                stopReplay();
              } else {
                const events  = historyData?.events ?? [];
                const fromIdx = replayIdxRef.current < events.length ? replayIdxRef.current : 0;
                startReplay(events, fromIdx, speed);
              }
            }}
            sx={{
              px: 2, py: 0.5, borderRadius: 1, border: '1px solid',
              borderColor: 'divider', bgcolor: 'background.paper',
              color: playing ? 'warning.main' : 'primary.main',
              cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {playing ? '⏸ Pause' : '▶ Play'}
          </Box>

          <ToggleButtonGroup
            value={speed}
            exclusive
            onChange={(_, v) => {
              if (v) {
                setSpeed(v);
                if (playing) startReplay(replayEventsRef.current, replayIdxRef.current, v);
              }
            }}
            size="small"
          >
            {[1, 10, 50].map((s) => (
              <ToggleButton key={s} value={s} sx={{ px: 1.5, fontSize: '0.65rem' }}>
                {s}×
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
            {playing ? 'replaying…' : 'paused'}
          </Typography>
        </Box>
      )}

      {/* Stats table */}
      {sortedStats.length > 0 && (
        <Box sx={{
          width: 420, mt: 2,
          border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden',
        }}>
          <Box sx={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 60px',
            px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
          }}>
            {['Currency', '→ XRP (sold)', 'XRP → (bought)', 'Flows'].map((h) => (
              <Typography key={h} variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontSize: '0.6rem' }}>
                {h}
              </Typography>
            ))}
          </Box>
          {sortedStats.map(([id, v]) => {
            const color = colorFor(id, ringCurrencies);
            const fmt = (n) => n > 0 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
            return (
              <Box key={id} sx={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 60px',
                alignItems: 'center', px: 2, py: 0.8,
                borderBottom: '1px solid', borderColor: 'divider',
                '&:last-child': { borderBottom: 'none' },
                '&:hover': { bgcolor: 'action.hover' },
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{id}</Typography>
                </Box>
                <Typography variant="body2" sx={{ color: 'primary.main', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                  {fmt(v.fromVolume)}
                </Typography>
                <Typography variant="body2" sx={{ color: 'info.main', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                  {fmt(v.toVolume)}
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
