# XRP Bridge Utility Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Bridge" tab to the Dashboard that shows real-time animated flows of auto-bridged trades routing through XRP, with a session-accumulating stats table per currency.

**Architecture:** Server-side bridge detection runs after `extractFills` in `ledgerProcessor.js` and publishes `bridge:fill` events via Redis pub/sub → WebSocket → client. The client queues events and animates them sequentially in a SVG ring visualization.

**Tech Stack:** Node.js (CommonJS), ioredis pub/sub, React + Zustand, SVG + requestAnimationFrame

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `server/src/ingest/bridgeDetector.js` | Pure function: fill array → bridge events |
| Create | `server/tests/unit/bridgeDetector.test.js` | Unit tests for bridge detection |
| Modify | `server/src/redis/publisher.js` | Add `CHANNELS.BRIDGE`, `buildBridgeMessage`, `publishBridge` |
| Modify | `server/tests/unit/publisher.test.js` | Add tests for bridge message builder |
| Modify | `server/src/ingest/ledgerProcessor.js` | Call `detectBridges` + `publishBridge` after `extractFills` |
| Modify | `server/src/api/ws.js` | Subscribe to `bridge:fill` Redis channel |
| Modify | `client/src/api/socket.js` | Handle `bridge:fill` WS message type |
| Modify | `client/src/store/useWsStore.js` | Add `bridges` array + `addBridge` action |
| Create | `client/src/hooks/useBridgeStream.js` | Queue + session stats from WS bridge events |
| Create | `client/src/components/BridgeView.jsx` | SVG ring visualization + stats table |
| Modify | `client/src/components/Dashboard.jsx` | Render `BridgeView` for `mode === 'bridge'` |
| Modify | `client/src/App.jsx` | Add `'bridge'` to MODES array |

---

## Task 1: Bridge Detector — Tests First

**Files:**
- Create: `server/src/ingest/bridgeDetector.js`
- Create: `server/tests/unit/bridgeDetector.test.js`

- [ ] **Step 1: Create the test file**

```js
// server/tests/unit/bridgeDetector.test.js
const { detectBridges } = require('../../src/ingest/bridgeDetector');

const TX = 'DEADBEEF01';
const LEDGER = 90000000;
const TIME = new Date('2025-01-01T00:00:00Z');

// Source leg: taker gave up USD to receive XRP (offer: TakerGets=XRP, TakerPays=USD)
function sourceLeg({ paysCurrency = 'USD', paysIssuer = 'rIssuer1', paysValue = '50', getsValue = '100' } = {}) {
  return {
    txHash: TX, ledgerIndex: LEDGER, ledgerTime: TIME,
    account: 'rMaker1',
    getsCurrency: 'XRP', getsIssuer: null, getsValue,
    paysCurrency, paysIssuer, paysValue,
    pairKey: `XRP|~${paysCurrency}|${paysIssuer}`, fillType: 'full',
  };
}

// Dest leg: taker gave up XRP to receive EUR (offer: TakerGets=EUR, TakerPays=XRP)
function destLeg({ getsCurrency = 'EUR', getsIssuer = 'rIssuer2', getsValue = '46', paysValue = '100' } = {}) {
  return {
    txHash: TX, ledgerIndex: LEDGER, ledgerTime: TIME,
    account: 'rMaker2',
    getsCurrency, getsIssuer, getsValue,
    paysCurrency: 'XRP', paysIssuer: null, paysValue,
    pairKey: `${getsCurrency}|${getsIssuer}~XRP|`, fillType: 'full',
  };
}

describe('detectBridges', () => {
  it('detects USD→XRP→EUR bridge', () => {
    const fills = [sourceLeg(), destLeg()];
    const result = detectBridges(fills);
    expect(result).toHaveLength(1);
    expect(result[0].fromCurrency).toBe('USD');
    expect(result[0].toCurrency).toBe('EUR');
    expect(result[0].fromIssuer).toBe('rIssuer1');
    expect(result[0].toIssuer).toBe('rIssuer2');
  });

  it('sets txHash, ledgerIndex, ledgerTime from fills', () => {
    const [b] = detectBridges([sourceLeg(), destLeg()]);
    expect(b.txHash).toBe(TX);
    expect(b.ledgerIndex).toBe(LEDGER);
    expect(b.ledgerTime).toBe(TIME);
  });

  it('sums xrpValue from source legs', () => {
    const fills = [
      sourceLeg({ getsValue: '60' }),
      sourceLeg({ getsValue: '40' }),
      destLeg(),
    ];
    const [b] = detectBridges(fills);
    expect(parseFloat(b.xrpValue)).toBeCloseTo(100);
  });

  it('sums fromValue from source legs', () => {
    const fills = [
      sourceLeg({ paysValue: '30' }),
      sourceLeg({ paysValue: '20' }),
      destLeg(),
    ];
    const [b] = detectBridges(fills);
    expect(parseFloat(b.fromValue)).toBeCloseTo(50);
  });

  it('sums toValue from dest legs', () => {
    const fills = [
      sourceLeg(),
      destLeg({ getsValue: '20' }),
      destLeg({ getsValue: '26' }),
    ];
    const [b] = detectBridges(fills);
    expect(parseFloat(b.toValue)).toBeCloseTo(46);
  });

  it('returns [] when no source legs', () => {
    expect(detectBridges([destLeg()])).toEqual([]);
  });

  it('returns [] when no dest legs', () => {
    expect(detectBridges([sourceLeg()])).toEqual([]);
  });

  it('returns [] for empty fills', () => {
    expect(detectBridges([])).toEqual([]);
  });

  it('returns [] for direct non-XRP fills', () => {
    const directFill = {
      txHash: TX, ledgerIndex: LEDGER, ledgerTime: TIME,
      account: 'rMaker3',
      getsCurrency: 'EUR', getsIssuer: 'rIssuer2', getsValue: '46',
      paysCurrency: 'USD', paysIssuer: 'rIssuer1', paysValue: '50',
      pairKey: 'EUR|rIssuer2~USD|rIssuer1', fillType: 'full',
    };
    expect(detectBridges([directFill])).toEqual([]);
  });

  it('returns [] when from and to are the same currency', () => {
    const fills = [
      sourceLeg({ paysCurrency: 'USD', paysIssuer: 'rA' }),
      destLeg({ getsCurrency: 'USD', getsIssuer: 'rB' }),
    ];
    expect(detectBridges(fills)).toEqual([]);
  });

  it('returns [] when xrpValue is zero', () => {
    const fills = [sourceLeg({ getsValue: '0' }), destLeg()];
    expect(detectBridges(fills)).toEqual([]);
  });

  it('returns [] for ambiguous multiple source currencies', () => {
    const fills = [
      sourceLeg({ paysCurrency: 'USD' }),
      sourceLeg({ paysCurrency: 'GBP' }),
      destLeg(),
    ];
    expect(detectBridges(fills)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
cd server && npx jest tests/unit/bridgeDetector.test.js --no-coverage
```

Expected: all tests fail with `Cannot find module '../../src/ingest/bridgeDetector'`

- [ ] **Step 3: Implement `bridgeDetector.js`**

```js
// server/src/ingest/bridgeDetector.js
function detectBridges(fills) {
  if (!fills.length) return [];

  const sourceLegs = fills.filter(f => f.getsCurrency === 'XRP');
  const destLegs   = fills.filter(f => f.paysCurrency === 'XRP');

  if (!sourceLegs.length || !destLegs.length) return [];

  const fromCurrencies = [...new Set(sourceLegs.map(f => f.paysCurrency))];
  const toCurrencies   = [...new Set(destLegs.map(f => f.getsCurrency))];

  if (fromCurrencies.length !== 1 || toCurrencies.length !== 1) return [];

  const fromCurrency = fromCurrencies[0];
  const toCurrency   = toCurrencies[0];

  if (fromCurrency === toCurrency || fromCurrency === 'XRP' || toCurrency === 'XRP') return [];

  let xrpValue  = 0;
  let fromValue = 0;
  let toValue   = 0;

  for (const f of sourceLegs) {
    xrpValue  += parseFloat(f.getsValue)  || 0;
    fromValue += parseFloat(f.paysValue) || 0;
  }
  for (const f of destLegs) {
    toValue += parseFloat(f.getsValue) || 0;
  }

  if (xrpValue <= 0) return [];

  const fromIssuer = sourceLegs.find(f => f.paysIssuer)?.paysIssuer ?? null;
  const toIssuer   = destLegs.find(f => f.getsIssuer)?.getsIssuer   ?? null;
  const { txHash, ledgerIndex, ledgerTime } = fills[0];

  return [{
    txHash,
    ledgerIndex,
    ledgerTime,
    fromCurrency,
    fromIssuer,
    fromValue: String(fromValue),
    toCurrency,
    toIssuer,
    toValue:  String(toValue),
    xrpValue: String(xrpValue),
  }];
}

module.exports = { detectBridges };
```

- [ ] **Step 4: Run tests — verify they all pass**

```bash
cd server && npx jest tests/unit/bridgeDetector.test.js --no-coverage
```

Expected: all 11 tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/ingest/bridgeDetector.js server/tests/unit/bridgeDetector.test.js
git commit -m "feat: add bridge detector — identifies auto-bridge fills within a tx"
```

---

## Task 2: Bridge Message Builder in `publisher.js`

**Files:**
- Modify: `server/src/redis/publisher.js`
- Modify: `server/tests/unit/publisher.test.js`

- [ ] **Step 1: Add failing tests for bridge message builder**

Append to `server/tests/unit/publisher.test.js`:

```js
const { buildBridgeMessage, CHANNELS } = require('../../src/redis/publisher');

const bridge = {
  txHash: 'BRIDGE01',
  ledgerIndex: 90000002,
  ledgerTime: new Date('2025-06-01T00:00:00Z'),
  fromCurrency: 'USD',
  fromIssuer: 'rIssuer1',
  fromValue: '50',
  toCurrency: 'EUR',
  toIssuer: 'rIssuer2',
  toValue: '46',
  xrpValue: '100',
};

describe('CHANNELS.BRIDGE', () => {
  it('equals bridge:fill', () => {
    expect(CHANNELS.BRIDGE).toBe('bridge:fill');
  });
});

describe('buildBridgeMessage', () => {
  it('sets type to bridge:fill', () => {
    expect(buildBridgeMessage(bridge).type).toBe('bridge:fill');
  });

  it('includes all bridge fields in data', () => {
    const msg = buildBridgeMessage(bridge);
    expect(msg.data.txHash).toBe('BRIDGE01');
    expect(msg.data.fromCurrency).toBe('USD');
    expect(msg.data.toCurrency).toBe('EUR');
    expect(msg.data.xrpValue).toBe('100');
    expect(msg.data.fromValue).toBe('50');
    expect(msg.data.toValue).toBe('46');
    expect(msg.data.fromIssuer).toBe('rIssuer1');
    expect(msg.data.toIssuer).toBe('rIssuer2');
    expect(msg.data.ledgerIndex).toBe(90000002);
  });

  it('serialises ledgerTime as ISO string', () => {
    const msg = buildBridgeMessage(bridge);
    expect(msg.data.ledgerTime).toBe('2025-06-01T00:00:00.000Z');
  });

  it('is JSON-serialisable', () => {
    expect(() => JSON.stringify(buildBridgeMessage(bridge))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run new tests — verify they fail**

```bash
cd server && npx jest tests/unit/publisher.test.js --no-coverage
```

Expected: the 5 new `bridge` tests fail; the existing 7 tests still pass

- [ ] **Step 3: Add `CHANNELS.BRIDGE`, `buildBridgeMessage`, `publishBridge` to `publisher.js`**

The file currently ends at line 55. Make these additions:

In `CHANNELS` object (after `TOPK_CHANGED`), add:
```js
BRIDGE: 'bridge:fill',
```

After `buildTopKChangedMessage`, add:

```js
function buildBridgeMessage(bridge) {
  return {
    type: 'bridge:fill',
    data: {
      txHash:       bridge.txHash,
      ledgerIndex:  bridge.ledgerIndex,
      ledgerTime:   bridge.ledgerTime instanceof Date
                      ? bridge.ledgerTime.toISOString()
                      : bridge.ledgerTime,
      fromCurrency: bridge.fromCurrency,
      fromIssuer:   bridge.fromIssuer,
      fromValue:    bridge.fromValue,
      toCurrency:   bridge.toCurrency,
      toIssuer:     bridge.toIssuer,
      toValue:      bridge.toValue,
      xrpValue:     bridge.xrpValue,
    },
  };
}

async function publishBridge(redis, bridge) {
  const msg = JSON.stringify(buildBridgeMessage(bridge));
  await redis.publish(CHANNELS.BRIDGE, msg);
}
```

Add `buildBridgeMessage` and `publishBridge` to `module.exports`.

- [ ] **Step 4: Run all publisher tests — verify they pass**

```bash
cd server && npx jest tests/unit/publisher.test.js --no-coverage
```

Expected: all 12 tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/redis/publisher.js server/tests/unit/publisher.test.js
git commit -m "feat: add bridge:fill channel and message builder to publisher"
```

---

## Task 3: Wire Bridge Detection into `ledgerProcessor.js`

**Files:**
- Modify: `server/src/ingest/ledgerProcessor.js`

- [ ] **Step 1: Add imports at the top of `ledgerProcessor.js`**

After the existing requires, add:
```js
const { detectBridges }  = require('./bridgeDetector');
const { publishBridge }  = require('../redis/publisher');
```

- [ ] **Step 2: Call `detectBridges` and `publishBridge` inside `handleTransaction`**

After the block that calls `publishFill` for each fill (around line 81–85), add:

```js
try {
  const bridges = detectBridges(fills);
  for (const b of bridges) {
    publishBridge(redis, b).catch((err) => {
      console.error('[BRIDGE] Failed to publish bridge event:', err.message);
    });
  }
} catch (err) {
  console.error('[BRIDGE] Detection error:', err.message);
}
```

- [ ] **Step 3: Run the full unit test suite to confirm no regressions**

```bash
cd server && npx jest --testPathPattern=unit --no-coverage
```

Expected: all existing unit tests still pass

- [ ] **Step 4: Commit**

```bash
git add server/src/ingest/ledgerProcessor.js
git commit -m "feat: detect and publish bridge events in ledger processor"
```

---

## Task 4: Subscribe to `bridge:fill` in the WebSocket Server

**Files:**
- Modify: `server/src/api/ws.js`

- [ ] **Step 1: Add `CHANNELS.BRIDGE` to `SUBSCRIBED_CHANNELS`**

Change line 4 from:
```js
const SUBSCRIBED_CHANNELS = [CHANNELS.FILLS, CHANNELS.TOPK_CHANGED];
```
to:
```js
const SUBSCRIBED_CHANNELS = [CHANNELS.FILLS, CHANNELS.TOPK_CHANGED, CHANNELS.BRIDGE];
```

No other changes needed — the existing `subscriber.on('message', ...)` handler already forwards all subscribed channels to WebSocket clients.

- [ ] **Step 2: Run unit tests to confirm no regressions**

```bash
cd server && npx jest --testPathPattern=unit --no-coverage
```

Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add server/src/api/ws.js
git commit -m "feat: subscribe WebSocket server to bridge:fill Redis channel"
```

---

## Task 5: Wire `bridge:fill` into Client Socket Handler and Store

**Files:**
- Modify: `client/src/api/socket.js`
- Modify: `client/src/store/useWsStore.js`

- [ ] **Step 1: Add `addBridge` action and `bridges` state to `useWsStore.js`**

Add `bridges: []` to the initial state (after `connected: false`):
```js
bridges:   [],
```

Add the `addBridge` action (after `setConnected`):
```js
addBridge: (bridge) =>
  set((s) => ({ bridges: [bridge, ...s.bridges].slice(0, 100) })),
```

- [ ] **Step 2: Handle `bridge:fill` messages in `socket.js`**

In `ws.onmessage`, after the `topk:changed` check, add:
```js
if (msg.type === 'bridge:fill') store.addBridge(msg.data);
```

- [ ] **Step 3: Commit**

```bash
git add client/src/api/socket.js client/src/store/useWsStore.js
git commit -m "feat: route bridge:fill WS messages into Zustand store"
```

---

## Task 6: `useBridgeStream` Hook

**Files:**
- Create: `client/src/hooks/useBridgeStream.js`

- [ ] **Step 1: Create the hook**

```js
// client/src/hooks/useBridgeStream.js
import { useEffect, useRef, useState } from 'react';
import { useWsStore } from '../store/useWsStore';

export function useBridgeStream() {
  const bridges = useWsStore((s) => s.bridges);
  const seenRef  = useRef(new Set());

  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState({}); // { [currency]: { volume: number, count: number } }

  useEffect(() => {
    let changed = false;
    const newItems = [];

    for (const bridge of bridges) {
      if (seenRef.current.has(bridge.txHash)) continue;
      seenRef.current.add(bridge.txHash);
      changed = true;
      newItems.push(bridge);
    }

    if (!changed) return;

    setStats((prev) => {
      const next = { ...prev };
      for (const bridge of newItems) {
        const xrp = parseFloat(bridge.xrpValue) || 0;
        for (const currency of [bridge.fromCurrency, bridge.toCurrency]) {
          next[currency] = {
            volume: (next[currency]?.volume ?? 0) + xrp / 2,
            count:  (next[currency]?.count  ?? 0) + 1,
          };
        }
      }
      return next;
    });

    setQueue((prev) => [...prev, ...newItems]);
  }, [bridges]);

  return { queue, setQueue, stats };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useBridgeStream.js
git commit -m "feat: useBridgeStream hook — queue and session stats from bridge WS events"
```

---

## Task 7: `BridgeView` Component

**Files:**
- Create: `client/src/components/BridgeView.jsx`

- [ ] **Step 1: Create the component**

```jsx
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
    const incoming = Object.keys(stats).filter((c) => !ringCurrencies.includes(c));
    if (!incoming.length) return;
    setRingCurrencies((prev) => [...prev, ...incoming].slice(0, MAX_RING));
  }, [stats]); // eslint-disable-line react-hooks/exhaustive-deps

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

    flashArc(arcsEl, from.x, from.y, CX, CY, fromColor);
    flashArc(arcsEl, CX, CY, to.x, to.y, toColor);

    animateLeg(svgRef.current, from.x, from.y, CX, CY, fromColor, 0)
      .then(() => {
        if (xrpCircle) {
          xrpCircle.style.filter = 'drop-shadow(0 0 18px rgba(0,166,204,0.95))';
          setTimeout(() => {
            xrpCircle.style.filter = 'drop-shadow(0 0 8px rgba(0,166,204,0.4))';
          }, 180);
        }
        return animateLeg(svgRef.current, CX, CY, to.x, to.y, toColor, 40);
      })
      .then(() => setAnimating(false));
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
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/BridgeView.jsx
git commit -m "feat: BridgeView — SVG ring with animated particle flows and stats table"
```

---

## Task 8: Add Bridge Tab to App and Dashboard

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/Dashboard.jsx`

- [ ] **Step 1: Add `'bridge'` to `MODES` in `App.jsx`**

Change line 11 from:
```js
const MODES = ['iou', 'mpt', 'amm', 'ledger'];
```
to:
```js
const MODES = ['iou', 'mpt', 'amm', 'ledger', 'bridge'];
```

- [ ] **Step 2: Render `BridgeView` in `Dashboard.jsx`**

Add the import at the top of `Dashboard.jsx`:
```js
import { BridgeView } from './BridgeView';
```

Add a `mode === 'bridge'` branch at the top of the `Dashboard` function, after the existing `mode === 'ledger'` branch:

```js
if (mode === 'bridge') {
  return (
    <Box sx={{ flex: 1, p: 1.5, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
      <BridgeView />
    </Box>
  );
}
```

- [ ] **Step 3: Start the dev server and verify the Bridge tab appears and works**

```bash
cd client && npm run dev
```

Open the app, click the BRIDGE tab in the header. Verify:
- The ring SVG renders with XRP at center
- "Waiting for bridge events…" text shows until the first event arrives
- When bridge events arrive, currencies appear on the ring and particles animate
- Stats table grows below the ring as events accumulate

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx client/src/components/Dashboard.jsx
git commit -m "feat: add Bridge tab to dashboard — wires BridgeView into app navigation"
```

---

## Self-Review Checklist

- [x] **Spec: bridge detection logic** → Task 1 (bridgeDetector.js)
- [x] **Spec: bridge publisher** → Task 2 (publisher.js additions)
- [x] **Spec: ledgerProcessor wiring** → Task 3
- [x] **Spec: ws.js channel subscription** → Task 4
- [x] **Spec: WS event shape** → Task 2 (buildBridgeMessage shape matches spec)
- [x] **Spec: useBridgeStream hook (queue + stats)** → Task 6
- [x] **Spec: BridgeView (ring, animation, stats table)** → Task 7
- [x] **Spec: 12-currency ring cap, extras still in stats** → Task 7 (MAX_RING + setRingCurrencies slicing)
- [x] **Spec: session accumulator** → Task 6 (stats never reset)
- [x] **Spec: sequential queue** → Task 7 (animating flag gates dequeue)
- [x] **Spec: Bridge tab on Dashboard** → Task 8
- [x] **Spec: nothing persisted to DB** → no DB tasks, confirmed
- [x] **Type consistency:** `detectBridges` returns `{ txHash, ledgerIndex, ledgerTime, fromCurrency, fromIssuer, fromValue, toCurrency, toIssuer, toValue, xrpValue }` — matches `buildBridgeMessage` fields — matches `msg.data` shape consumed in `useBridgeStream`
