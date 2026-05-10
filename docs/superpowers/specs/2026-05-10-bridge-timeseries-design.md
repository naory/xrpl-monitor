# Bridge Timeseries & Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist bridge events to a Redis sorted set (up to 24h), expose them via a REST endpoint, and add a time-window selector, stacked sparkline bar chart, and play/pause/speed replay controls to BridgeView.

**Architecture:** Raw bridge events are stored in a single Redis sorted set (`bridge:log`) scored by ms timestamp, trimmed on each ledger close. A single API endpoint returns events for a given window (oldest-first). The client does all aggregation (per-currency summary, time-bucketed series, top-5 + other grouping) inside a `useBridgeHistory` hook. BridgeView has two modes — Live (existing behavior) and Historical — toggled by a window selector; replay is driven by a `setInterval` ticker that paces events from the history fetch into the existing animation queue.

**Tech Stack:** Node.js/Express, ioredis (sorted sets), React, MUI (ToggleButtonGroup, existing components), SVG (bar chart, no new chart library)

---

## Data Layer

### Redis key

```
bridge:log        sorted set, score = Date.now() (ms epoch)
                  member = JSON string of bridge event
```

### Event JSON shape (member of `bridge:log`)

```json
{
  "txHash": "ABC123",
  "ledgerTime": "2026-05-10T12:00:00.000Z",
  "fromCurrency": "USD",
  "fromIssuer": "rHb9...",
  "fromValue": "100.5",
  "toCurrency": "EUR",
  "toIssuer": "rHb9...",
  "toValue": "92.3",
  "xrpValue": "205.0"
}
```

### Windows

| Window | Size       | Sparkline bucket | Bars |
|--------|------------|-----------------|------|
| `10m`  | 600 000 ms | 30s             | 20   |
| `1h`   | 3 600 000 ms | 5min           | 12   |
| `24h`  | 86 400 000 ms | 1h            | 24   |

---

## Server

### `server/src/redis/bridgeTimeseries.js` (new)

```js
const LOG_KEY = 'bridge:log';
const WINDOWS = { '10m': 10 * 60 * 1000, '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000 };
const BUCKET_MS = { '10m': 30_000, '1h': 5 * 60_000, '24h': 60 * 60_000 };

async function recordBridgeEvent(redis, bridge, now = Date.now()) {
  await redis.zadd(LOG_KEY, now, JSON.stringify(bridge));
}

async function getBridgeEvents(redis, window, now = Date.now()) {
  const size = WINDOWS[window];
  if (!size) throw new Error(`Unknown window: ${window}`);
  const from = now - size;
  const items = await redis.zrangebyscore(LOG_KEY, from, '+inf');
  return items.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

async function trimBridgeEvents(redis, now = Date.now()) {
  const cutoff = now - WINDOWS['24h'];
  await redis.zremrangebyscore(LOG_KEY, '-inf', cutoff);
}

module.exports = { LOG_KEY, WINDOWS, BUCKET_MS, recordBridgeEvent, getBridgeEvents, trimBridgeEvents };
```

### `server/src/api/bridge.js` (new)

```js
const { Router } = require('express');
const { getBridgeEvents, WINDOWS } = require('../redis/bridgeTimeseries');

function createBridgeRouter({ redis }) {
  const router = Router();

  router.get('/events', async (req, res) => {
    const { window = '1h' } = req.query;
    if (!WINDOWS[window]) {
      return res.status(400).json({ error: `Unknown window. Valid: ${Object.keys(WINDOWS).join(', ')}` });
    }
    try {
      const events = await getBridgeEvents(redis, window);
      res.json({ window, events });
    } catch (err) {
      console.error('[BRIDGE/EVENTS] Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createBridgeRouter };
```

### `server/src/api/app.js` — add bridge router

```js
const { createBridgeRouter } = require('./bridge');
// in createApp:
app.use('/bridge', createBridgeRouter({ redis }));
```

### `server/src/ingest/ledgerProcessor.js` — record + trim

In `handleTransaction`, alongside `publishBridge`:
```js
const { recordBridgeEvent } = require('../redis/bridgeTimeseries');
// after detectBridges loop:
for (const b of bridges) {
  publishBridge(redis, b).catch(...);
  recordBridgeEvent(redis, b).catch((err) => {
    console.error('[BRIDGE] Failed to record event:', err.message);
  });
}
```

In `handleLedgerClosed`, alongside `trimWindows`:
```js
const { trimBridgeEvents } = require('../redis/bridgeTimeseries');
trimBridgeEvents(redis).catch((err) => {
  console.error('[BRIDGE] Failed to trim events:', err.message);
});
```

---

## Client

### `client/src/hooks/useBridgeHistory.js` (new)

Fetches `/bridge/events?window=X`, returns:

- `events` — raw array ordered by `ledgerTime` (oldest first), used for replay
- `summary` — `{ [currency]: { fromVolume, toVolume, count } }` — same shape as `useBridgeStream` stats, so ring and table render without changes
- `series` — `[{ ts: <bucket_start_ms>, currencies: { USD: xrp, XAH: xrp, other: xrp } }]` for the sparkline. Top 5 currencies by total window volume; remainder grouped as `"other"`.
- `loading` — boolean
- `topCurrencies` — array of up to 5 currency IDs in volume-descending order (for consistent bar colors)

Re-fetches when `window` prop changes and polls every 30s while mounted.

```js
import { useState, useEffect, useRef } from 'react';
import { BUCKET_MS } from '../../../server/src/redis/bridgeTimeseries'; // constants duplicated client-side

const BUCKET_MS_CLIENT = { '10m': 30_000, '1h': 5 * 60_000, '24h': 60 * 60_000 };
const WINDOWS_MS = { '10m': 10 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 };

export function useBridgeHistory(window) {
  const [events, setEvents]           = useState([]);
  const [summary, setSummary]         = useState({});
  const [series, setSeries]           = useState([]);
  const [topCurrencies, setTop]       = useState([]);
  const [loading, setLoading]         = useState(false);
  const intervalRef = useRef(null);

  function aggregate(evs, win) {
    const bucketMs = BUCKET_MS_CLIENT[win];
    const windowMs = WINDOWS_MS[win];
    const now = Date.now();
    const windowStart = now - windowMs;

    const summ = {};
    const byCurrency = {};

    for (const ev of evs) {
      const xrp = parseFloat(ev.xrpValue) || 0;
      const fc = ev.fromCurrency, tc = ev.toCurrency;
      summ[fc] = { fromVolume: (summ[fc]?.fromVolume ?? 0) + xrp, toVolume: summ[fc]?.toVolume ?? 0, count: (summ[fc]?.count ?? 0) + 1 };
      summ[tc] = { fromVolume: summ[tc]?.fromVolume ?? 0, toVolume: (summ[tc]?.toVolume ?? 0) + xrp, count: (summ[tc]?.count ?? 0) + 1 };
      byCurrency[fc] = (byCurrency[fc] ?? 0) + xrp;
      byCurrency[tc] = (byCurrency[tc] ?? 0) + xrp;
    }

    const top5 = Object.entries(byCurrency).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);

    const numBuckets = Math.ceil(windowMs / bucketMs);
    const buckets = Array.from({ length: numBuckets }, (_, i) => ({
      ts: windowStart + i * bucketMs,
      currencies: Object.fromEntries([...top5, 'other'].map((c) => [c, 0])),
    }));

    for (const ev of evs) {
      const ts = new Date(ev.ledgerTime).getTime();
      const idx = Math.floor((ts - windowStart) / bucketMs);
      if (idx < 0 || idx >= numBuckets) continue;
      const xrp = parseFloat(ev.xrpValue) || 0;
      const currencies = [ev.fromCurrency, ev.toCurrency];
      for (const c of currencies) {
        const key = top5.includes(c) ? c : 'other';
        buckets[idx].currencies[key] = (buckets[idx].currencies[key] ?? 0) + xrp / 2;
      }
    }

    return { summ, buckets, top5 };
  }

  async function fetch(win) {
    setLoading(true);
    try {
      const res = await window.fetch(`/bridge/events?window=${win}`);
      const { events: evs } = await res.json();
      const sorted = [...evs].sort((a, b) => new Date(a.ledgerTime) - new Date(b.ledgerTime));
      const { summ, buckets, top5 } = aggregate(sorted, win);
      setEvents(sorted);
      setSummary(summ);
      setSeries(buckets);
      setTop(top5);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch(window);
    intervalRef.current = setInterval(() => fetch(window), 30_000);
    return () => clearInterval(intervalRef.current);
  }, [window]);

  return { events, summary, series, topCurrencies, loading };
}
```

Note: `window` prop shadows global `window`; the implementation must use a local alias for `fetch` or import it explicitly. This is handled in the actual implementation by aliasing: `const fetchData = async (win) => { const res = await fetch(...)`.

### `client/src/components/BridgeView.jsx` — additions

**State added:**
```js
const [viewWindow, setViewWindow] = useState('live'); // 'live' | '10m' | '1h' | '24h'
const [playing, setPlaying]       = useState(false);
const [speed, setSpeed]           = useState(10);     // multiplier: 1 | 10 | 50
const replayRef                   = useRef(null);     // setInterval handle
```

**Mode switching:**
- `viewWindow === 'live'` → use `useBridgeStream` stats (existing), animation queue driven by live WS events
- historical → use `useBridgeHistory(viewWindow)` stats for ring weights + table; animation queue idle until Play

**Replay logic:**
```js
function startReplay(events, speedMultiplier) {
  let idx = 0;
  const sorted = [...events].sort((a, b) => new Date(a.ledgerTime) - new Date(b.ledgerTime));
  if (!sorted.length) return;
  const spanMs = new Date(sorted[sorted.length - 1].ledgerTime) - new Date(sorted[0].ledgerTime);
  const tickMs = 200; // poll every 200ms real time
  const replayMs = tickMs * speedMultiplier; // how much replay-time per real tick

  let replayElapsed = 0;
  const startTime = new Date(sorted[0].ledgerTime).getTime();

  replayRef.current = setInterval(() => {
    replayElapsed += replayMs;
    const replayCursor = startTime + replayElapsed;
    const batch = [];
    while (idx < sorted.length && new Date(sorted[idx].ledgerTime).getTime() <= replayCursor) {
      batch.push(sorted[idx++]);
    }
    if (batch.length) setQueue((q) => [...q, ...batch]);
    if (idx >= sorted.length) {
      clearInterval(replayRef.current);
      setPlaying(false);
    }
  }, tickMs);
}

function stopReplay() {
  clearInterval(replayRef.current);
  setPlaying(false);
}
```

**Sparkline bar chart** — pure SVG, 420×80px, rendered below the window selector and above the stats table. Each bar stacked by top-5 currencies + "other", using `colorFor` for top currencies and `#444` for "other". Clicking a bar seeks replay: `idx` is reset to the first event at or after that bucket's `ts`, and if currently playing, replay restarts from there.

**Layout order in BridgeView return:**
1. Title (`XRP Bridge Utility — Live` / `XRP Bridge Utility — {window}`)
2. Ring SVG (unchanged rendering, stats source swapped by mode)
3. Window selector (`ToggleButtonGroup`: Live | 10m | 1h | 24h)
4. Sparkline bar chart (hidden in Live mode)
5. Replay controls row: Play/Pause | Speed (1× 10× 50×) — hidden in Live mode
6. Stats table (unchanged rendering, stats source swapped by mode)

---

## What does NOT change

- `useBridgeStream` — untouched; Live mode still uses it
- `BridgeView` ring rendering, particle animation, arc flash, weighted edges — untouched
- `bridgeDetector.js`, `publisher.js` — untouched
- No new npm dependencies

---

## Future extension point

When hourly-resolution multi-day storage is added (Postgres), `useBridgeHistory` can be updated to call a different endpoint for windows > 24h. The aggregation and rendering code remains the same.
