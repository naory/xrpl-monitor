// client/src/components/BridgeView.jsx
import { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useBridgeStream } from '../hooks/useBridgeStream';

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

function animateLeg(svgEl, x1, y1, x2, y2, color, delay) {
  return new Promise((resolve) => {
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

export function BridgeView() {
  const { queue, setQueue, stats } = useBridgeStream();
  const svgRef      = useRef(null);
  const [animating, setAnimating] = useState(false);
  const [ringCurrencies, setRingCurrencies] = useState([]);

  // Grow the ring as new currencies appear in stats
  useEffect(() => {
    setRingCurrencies((prev) => {
      const incoming = Object.keys(stats).filter((c) => !prev.includes(c));
      if (!incoming.length) return prev;
      return [...prev, ...incoming].slice(0, MAX_RING);
    });
  }, [stats]);

  const positions = ringPositions(ringCurrencies);

  // Animation queue processor
  useEffect(() => {
    if (animating || queue.length === 0 || !svgRef.current) return;

    const [next, ...rest] = queue;
    setQueue(rest);
    setAnimating(true);

    const from = positions.find((p) => p.id === next.fromCurrency);
    const to   = positions.find((p) => p.id === next.toCurrency);

    if (!from || !to) { setAnimating(false); return; }

    const fromColor = colorFor(from.id, ringCurrencies);
    const toColor   = colorFor(to.id,   ringCurrencies);
    const arcsEl    = svgRef.current.querySelector('#arcs');
    const xrpCircle = svgRef.current.querySelector('#xrp-circle');
    let cancelled   = false;

    flashArc(arcsEl, from.x, from.y, CX, CY, fromColor);
    flashArc(arcsEl, CX, CY, to.x, to.y, toColor);

    animateLeg(svgRef.current, from.x, from.y, CX, CY, fromColor, 0)
      .then(() => {
        if (cancelled) return Promise.reject(new Error('cancelled'));
        if (xrpCircle) {
          xrpCircle.style.filter = 'drop-shadow(0 0 18px rgba(0,166,204,0.95))';
          setTimeout(() => {
            if (!cancelled && xrpCircle) xrpCircle.style.filter = 'drop-shadow(0 0 8px rgba(0,166,204,0.4))';
          }, 180);
        }
        if (!svgRef.current) return Promise.reject(new Error('cancelled'));
        return animateLeg(svgRef.current, CX, CY, to.x, to.y, toColor, 40);
      })
      .then(() => { if (!cancelled) setAnimating(false); })
      .catch(() => setAnimating(false));

    return () => { cancelled = true; };
  }, [queue, animating, positions, ringCurrencies]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedStats = Object.entries(stats)
    .sort((a, b) => b[1].volume - a[1].volume);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 2, height: '100%', overflow: 'auto' }}>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2, letterSpacing: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>
        XRP Bridge Utility — Live
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

      {/* Stats table */}
      {sortedStats.length > 0 && (
        <Box sx={{
          width: 420, mt: 2,
          border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden',
        }}>
          <Box sx={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 80px',
            px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
          }}>
            {['Currency', 'Bridged (XRP)', 'Flows'].map((h) => (
              <Typography key={h} variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {h}
              </Typography>
            ))}
          </Box>
          {sortedStats.map(([id, v]) => {
            const color = colorFor(id, ringCurrencies);
            return (
              <Box key={id} sx={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 80px',
                alignItems: 'center', px: 2, py: 0.8,
                borderBottom: '1px solid', borderColor: 'divider',
                '&:last-child': { borderBottom: 'none' },
                '&:hover': { bgcolor: 'action.hover' },
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{id}</Typography>
                </Box>
                <Typography variant="body2" sx={{ color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}>
                  {v.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })} XRP
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
