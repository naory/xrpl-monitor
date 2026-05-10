# Bridge Timeseries & Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist bridge events to Redis (24h rolling window), expose them via a REST endpoint, and add a time-window selector, stacked sparkline bar chart, and play/pause/speed replay controls to BridgeView.

**Architecture:** Raw bridge events are appended to a single Redis sorted set (`bridge:log`) scored by ms timestamp and trimmed on each ledger close. A single `GET /bridge/events?window=X` endpoint returns events in the requested window oldest-first. The client hook (`useBridgeHistory`) fetches and aggregates client-side: per-currency summary (same shape as the live stream) and time-bucketed series for the sparkline (top 5 currencies + "other"). BridgeView gains a `viewWindow` state that switches it between Live mode (existing behavior) and Historical mode (data from the hook); replay is driven by a `setInterval` ticker that paces historical events into the existing animation queue.

**Tech Stack:** Node.js/Express, ioredis (sorted sets), React, @tanstack/react-query, MUI ToggleButtonGroup, SVG (no new chart library)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/src/redis/bridgeTimeseries.js` | **Create** | Record, fetch, trim bridge events in Redis |
| `server/tests/unit/bridgeTimeseries.test.js` | **Create** | Unit tests for WINDOWS/BUCKET_MS constants |
| `server/tests/integration/bridgeTimeseries.test.js` | **Create** | Integration tests for Redis record/fetch/trim |
| `server/src/ingest/ledgerProcessor.js` | **Modify** | Call recordBridgeEvent + trimBridgeEvents |
| `server/src/api/bridge.js` | **Create** | GET /bridge/events?window=X endpoint |
| `server/src/api/app.js` | **Modify** | Mount /bridge router |
| `client/src/api/http.js` | **Modify** | Add fetchBridgeEvents |
| `client/src/hooks/useBridgeHistory.js` | **Create** | Fetch + aggregate hook (React Query) |
| `client/src/components/BridgeView.jsx` | **Modify** | Window selector, sparkline, replay controls |

---

### Task 1: Redis data layer — `bridgeTimeseries.js`

**Files:**
- Create: `server/src/redis/bridgeTimeseries.js`
- Create: `server/tests/unit/bridgeTimeseries.test.js`

- [ ] **Step 1: Write the failing unit test**

```js
// server/tests/unit/bridgeTimeseries.test.js
const { WINDOWS, BUCKET_MS } = require('../../src/redis/bridgeTimeseries');

describe('WINDOWS', () => {
  it('defines 10m, 1h, 24h in milliseconds', () => {
    expect(WINDOWS['10m']).toBe(10 * 60 * 1000);
    expect(WINDOWS['1h']).toBe(60 * 60 * 1000);
    expect(WINDOWS['24h']).toBe(24 * 60 * 60 * 1000);
  });

  it('has no unknown keys', () => {
    expect(Object.keys(WINDOWS)).toEqual(['10m', '1h', '24h']);
  });
});

describe('BUCKET_MS', () => {
  it('defines bucket sizes per window', () => {
    expect(BUCKET_MS['10m']).toBe(30_000);
    expect(BUCKET_MS['1h']).toBe(5 * 60_000);
    expect(BUCKET_MS['24h']).toBe(60 * 60_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && npx jest tests/unit/bridgeTimeseries.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../../src/redis/bridgeTimeseries'`

- [ ] **Step 3: Create `server/src/redis/bridgeTimeseries.js`**

```js
const LOG_KEY = 'bridge:log';

const WINDOWS = {
  '10m': 10 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

const BUCKET_MS = {
  '10m': 30_000,
  '1h':  5 * 60_000,
  '24h': 60 * 60_000,
};

async function recordBridgeEvent(redis, bridge, now = Date.now()) {
  await redis.zadd(LOG_KEY, now, JSON.stringify({
    txHash:       bridge.txHash,
    ledgerTime:   bridge.ledgerTime instanceof Date
                    ? bridge.ledgerTime.toISOString()
                    : bridge.ledgerTime,
    fromCurrency: bridge.fromCurrency,
    fromIssuer:   bridge.fromIssuer ?? null,
    fromValue:    bridge.fromValue,
    toCurrency:   bridge.toCurrency,
    toIssuer:     bridge.toIssuer ?? null,
    toValue:      bridge.toValue,
    xrpValue:     bridge.xrpValue,
  }));
}

async function getBridgeEvents(redis, window, now = Date.now()) {
  if (!WINDOWS[window]) throw new Error(`Unknown window: ${window}`);
  const from = now - WINDOWS[window];
  const items = await redis.zrangebyscore(LOG_KEY, from, '+inf');
  return items
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter(Boolean);
}

async function trimBridgeEvents(redis, now = Date.now()) {
  const cutoff = now - WINDOWS['24h'];
  await redis.zremrangebyscore(LOG_KEY, '-inf', cutoff);
}

module.exports = { LOG_KEY, WINDOWS, BUCKET_MS, recordBridgeEvent, getBridgeEvents, trimBridgeEvents };
```

- [ ] **Step 4: Run the unit test to verify it passes**

```bash
cd server && npx jest tests/unit/bridgeTimeseries.test.js --no-coverage
```

Expected: PASS (2 describe blocks, 3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/redis/bridgeTimeseries.js server/tests/unit/bridgeTimeseries.test.js
git commit -m "feat: bridge timeseries Redis module"
```

---

### Task 2: Integration tests for Redis record/fetch/trim

**Files:**
- Create: `server/tests/integration/bridgeTimeseries.test.js`

- [ ] **Step 1: Write the integration tests**

```js
// server/tests/integration/bridgeTimeseries.test.js
/**
 * Requires Redis (docker-compose). Skips gracefully when unavailable.
 * Run: REDIS_PORT=6380 npx jest tests/integration/bridgeTimeseries.test.js
 */
const Redis = require('ioredis');
const { LOG_KEY, recordBridgeEvent, getBridgeEvents, trimBridgeEvents } = require('../../src/redis/bridgeTimeseries');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  lazyConnect: true,
  connectTimeout: 3000,
});

let available = false;

beforeAll(async () => {
  try { await redis.connect(); available = true; }
  catch { console.warn('[INTEGRATION] Redis unavailable — skipping bridgeTimeseries tests'); }
});

afterAll(async () => { await redis.quit().catch(() => {}); });

beforeEach(async () => {
  if (available) await redis.del(LOG_KEY);
});

function makeBridge(overrides = {}) {
  return {
    txHash:       'TXHASH001',
    ledgerTime:   new Date('2026-05-10T10:00:00Z'),
    fromCurrency: 'USD',
    fromIssuer:   'rIssuer1',
    fromValue:    '100',
    toCurrency:   'EUR',
    toIssuer:     'rIssuer2',
    toValue:      '92',
    xrpValue:     '205',
    ...overrides,
  };
}

describe('recordBridgeEvent', () => {
  it('stores a bridge event in the sorted set', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge(), now);
    const count = await redis.zcard(LOG_KEY);
    expect(count).toBe(1);
  });

  it('stores multiple distinct events', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge({ txHash: 'TX001' }), now);
    await recordBridgeEvent(redis, makeBridge({ txHash: 'TX002' }), now + 1);
    expect(await redis.zcard(LOG_KEY)).toBe(2);
  });

  it('converts Date ledgerTime to ISO string', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge({ ledgerTime: new Date('2026-05-10T10:00:00Z') }), now);
    const [raw] = await redis.zrange(LOG_KEY, 0, 0);
    const parsed = JSON.parse(raw);
    expect(parsed.ledgerTime).toBe('2026-05-10T10:00:00.000Z');
  });
});

describe('getBridgeEvents', () => {
  it('returns events within the window', async () => {
    if (!available) return;
    const now = Date.now();
    const recent = now - 5 * 60 * 1000; // 5 minutes ago — inside 10m
    const old    = now - 20 * 60 * 1000; // 20 minutes ago — outside 10m, inside 1h
    await recordBridgeEvent(redis, makeBridge({ txHash: 'RECENT' }), recent);
    await recordBridgeEvent(redis, makeBridge({ txHash: 'OLD'    }), old);

    const events10m = await getBridgeEvents(redis, '10m', now);
    expect(events10m).toHaveLength(1);
    expect(events10m[0].txHash).toBe('RECENT');

    const events1h = await getBridgeEvents(redis, '1h', now);
    expect(events1h).toHaveLength(2);
  });

  it('returns events oldest-first (sorted by score)', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge({ txHash: 'NEWER' }), now);
    await recordBridgeEvent(redis, makeBridge({ txHash: 'OLDER' }), now - 1000);
    const events = await getBridgeEvents(redis, '1h', now);
    expect(events[0].txHash).toBe('OLDER');
    expect(events[1].txHash).toBe('NEWER');
  });

  it('throws for unknown window', async () => {
    if (!available) return;
    await expect(getBridgeEvents(redis, '7d')).rejects.toThrow('Unknown window');
  });

  it('returns empty array when no events in window', async () => {
    if (!available) return;
    const events = await getBridgeEvents(redis, '10m');
    expect(events).toEqual([]);
  });
});

describe('trimBridgeEvents', () => {
  it('removes events older than 24h', async () => {
    if (!available) return;
    const now = Date.now();
    const old = now - 25 * 60 * 60 * 1000; // 25h ago
    await recordBridgeEvent(redis, makeBridge({ txHash: 'OLD'    }), old);
    await recordBridgeEvent(redis, makeBridge({ txHash: 'RECENT' }), now);
    await trimBridgeEvents(redis, now);
    const events = await getBridgeEvents(redis, '24h', now);
    expect(events).toHaveLength(1);
    expect(events[0].txHash).toBe('RECENT');
  });

  it('is a no-op when all events are within 24h', async () => {
    if (!available) return;
    const now = Date.now();
    await recordBridgeEvent(redis, makeBridge(), now - 60_000);
    await trimBridgeEvents(redis, now);
    expect(await redis.zcard(LOG_KEY)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the integration tests**

```bash
cd server && REDIS_PORT=6380 npx jest tests/integration/bridgeTimeseries.test.js --no-coverage
```

Expected: PASS (all tests pass, or skipped if Redis unavailable)

- [ ] **Step 3: Commit**

```bash
git add server/tests/integration/bridgeTimeseries.test.js
git commit -m "test: bridge timeseries integration tests"
```

---

### Task 3: Wire bridge record + trim into ledgerProcessor

**Files:**
- Modify: `server/src/ingest/ledgerProcessor.js`

Context: `ledgerProcessor.js` already imports `detectBridges` and `publishBridge`. The bridge detection block (around lines 99–108) is where `recordBridgeEvent` must be called. `trimBridgeEvents` must be called in `handleLedgerClosed` alongside `trimWindows` (around line 154).

- [ ] **Step 1: Add imports at top of `ledgerProcessor.js`**

Add to the existing require block (after the `publishBridge` require on line 12):

```js
const { recordBridgeEvent, trimBridgeEvents } = require('../redis/bridgeTimeseries');
```

- [ ] **Step 2: Call `recordBridgeEvent` in the bridge detection block**

Find this block (around line 99):

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

Replace with:

```js
    try {
      const bridges = detectBridges(fills);
      for (const b of bridges) {
        publishBridge(redis, b).catch((err) => {
          console.error('[BRIDGE] Failed to publish bridge event:', err.message);
        });
        recordBridgeEvent(redis, b).catch((err) => {
          console.error('[BRIDGE] Failed to record bridge event:', err.message);
        });
      }
    } catch (err) {
      console.error('[BRIDGE] Detection error:', err.message);
    }
```

- [ ] **Step 3: Call `trimBridgeEvents` in `handleLedgerClosed`**

Find this block in `handleLedgerClosed` (around line 154):

```js
    trimWindows(redis).catch((err) => {
      console.error('[VOLUME] Failed to trim windows:', err.message);
    });
    trimAmmWindows(redis).catch((err) => {
      console.error('[AMM] Failed to trim windows:', err.message);
    });
    trimLedgerStats(redis).catch((err) => {
      console.error('[LSTATS] Failed to trim windows:', err.message);
    });
```

Replace with:

```js
    trimWindows(redis).catch((err) => {
      console.error('[VOLUME] Failed to trim windows:', err.message);
    });
    trimAmmWindows(redis).catch((err) => {
      console.error('[AMM] Failed to trim windows:', err.message);
    });
    trimLedgerStats(redis).catch((err) => {
      console.error('[LSTATS] Failed to trim windows:', err.message);
    });
    trimBridgeEvents(redis).catch((err) => {
      console.error('[BRIDGE] Failed to trim events:', err.message);
    });
```

- [ ] **Step 4: Run the full unit test suite to make sure nothing broke**

```bash
cd server && npx jest tests/unit --no-coverage
```

Expected: All unit tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ingest/ledgerProcessor.js
git commit -m "feat: record and trim bridge events on each ledger close"
```

---

### Task 4: API endpoint `GET /bridge/events`

**Files:**
- Create: `server/src/api/bridge.js`
- Modify: `server/src/api/app.js`

- [ ] **Step 1: Create `server/src/api/bridge.js`**

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

- [ ] **Step 2: Mount in `server/src/api/app.js`**

Add the import line after the existing requires:

```js
const { createBridgeRouter } = require('./bridge');
```

Add the mount line inside `createApp` after the existing mounts:

```js
app.use('/bridge', createBridgeRouter({ redis }));
```

Full `app.js` after both changes:

```js
const express = require('express');
const { createHealthRouter } = require('./health');
const { createBookRouter }   = require('./book');
const { createFillsRouter }  = require('./fills');
const { createAmmRouter }    = require('./amm');
const { createLedgerRouter } = require('./ledger');
const { createBridgeRouter } = require('./bridge');

function createApp({ pool, redis, state, xrplClient, pairRegistry }) {
  const app = express();
  app.use(express.json());

  app.use('/health', createHealthRouter({ state, pool, redis }));
  app.use('/book',   createBookRouter({ redis, xrplClient, pairRegistry }));
  app.use('/fills',  createFillsRouter({ pool, redis }));
  app.use('/amm',    createAmmRouter({ redis }));
  app.use('/ledger', createLedgerRouter({ redis }));
  app.use('/bridge', createBridgeRouter({ redis }));

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 3: Smoke test the endpoint against a running server**

Start the server (if not already running):
```bash
cd server && REDIS_PORT=6380 PGPORT=5434 PGUSER=xrpl PGPASSWORD=xrplpass PGDATABASE=xrpl_monitor npm run dev
```

In a second terminal:
```bash
curl -s "http://localhost:3004/bridge/events?window=1h" | jq '{window, count: (.events | length)}'
```

Expected output:
```json
{ "window": "1h", "count": <number> }
```

Also verify bad window returns 400:
```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3004/bridge/events?window=7d"
```
Expected: `400`

- [ ] **Step 4: Commit**

```bash
git add server/src/api/bridge.js server/src/api/app.js
git commit -m "feat: GET /bridge/events endpoint"
```

---

### Task 5: Client API + history hook

**Files:**
- Modify: `client/src/api/http.js`
- Create: `client/src/hooks/useBridgeHistory.js`

- [ ] **Step 1: Add `fetchBridgeEvents` to `client/src/api/http.js`**

Append to the existing file:

```js
export function fetchBridgeEvents(timeWindow) {
  return api.get('/bridge/events', { params: { window: timeWindow } }).then((r) => r.data);
}
```

- [ ] **Step 2: Write a unit test for the aggregate logic**

This test exercises the pure aggregation function extracted into the hook file. Create the test file first:

```js
// client/src/hooks/useBridgeHistory.test.js
import { describe, it, expect } from 'vitest';
import { aggregateBridgeEvents } from './useBridgeHistory';

const BUCKET_MS = { '10m': 30_000, '1h': 5 * 60_000, '24h': 60 * 60_000 };
const WINDOWS_MS = { '10m': 10 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 };

function makeEvent(overrides = {}) {
  return {
    txHash:       'TX001',
    ledgerTime:   new Date().toISOString(),
    fromCurrency: 'USD',
    toCurrency:   'EUR',
    xrpValue:     '100',
    fromValue:    '50',
    toValue:      '46',
    ...overrides,
  };
}

describe('aggregateBridgeEvents', () => {
  const now = Date.now();

  it('builds summary with fromVolume and toVolume per currency', () => {
    const events = [makeEvent({ ledgerTime: new Date(now - 60_000).toISOString() })];
    const { summary } = aggregateBridgeEvents(events, '1h', now);
    expect(summary['USD'].fromVolume).toBeCloseTo(100);
    expect(summary['USD'].toVolume).toBe(0);
    expect(summary['EUR'].toVolume).toBeCloseTo(100);
    expect(summary['EUR'].fromVolume).toBe(0);
    expect(summary['USD'].count).toBe(1);
  });

  it('accumulates multiple events for the same currency', () => {
    const events = [
      makeEvent({ txHash: 'TX1', ledgerTime: new Date(now - 60_000).toISOString(), xrpValue: '100' }),
      makeEvent({ txHash: 'TX2', ledgerTime: new Date(now - 30_000).toISOString(), xrpValue: '50'  }),
    ];
    const { summary } = aggregateBridgeEvents(events, '1h', now);
    expect(summary['USD'].fromVolume).toBeCloseTo(150);
    expect(summary['USD'].count).toBe(2);
  });

  it('returns topCurrencies sorted by total volume descending, max 5', () => {
    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'];
    const events = currencies.map((fc, i) =>
      makeEvent({ txHash: `TX${i}`, fromCurrency: fc, toCurrency: 'XAH', xrpValue: String((6 - i) * 10), ledgerTime: new Date(now - 60_000).toISOString() })
    );
    const { topCurrencies } = aggregateBridgeEvents(events, '1h', now);
    expect(topCurrencies).toHaveLength(5);
    expect(topCurrencies[0]).toBe('USD'); // highest volume
  });

  it('returns correct number of buckets for each window', () => {
    const ev = makeEvent({ ledgerTime: new Date(now - 60_000).toISOString() });
    expect(aggregateBridgeEvents([ev], '10m', now).series).toHaveLength(20);
    expect(aggregateBridgeEvents([ev], '1h',  now).series).toHaveLength(12);
    expect(aggregateBridgeEvents([ev], '24h', now).series).toHaveLength(24);
  });

  it('places events in correct bucket', () => {
    const bucketMs = BUCKET_MS['1h']; // 5min
    const ts = now - 7 * 60_000; // 7 minutes ago → bucket index 1 (counting from window end)
    const windowMs = WINDOWS_MS['1h'];
    const windowStart = now - windowMs;
    const expectedIdx = Math.floor((ts - windowStart) / bucketMs);
    const ev = makeEvent({ ledgerTime: new Date(ts).toISOString() });
    const { series } = aggregateBridgeEvents([ev], '1h', now);
    const bucketTotal = Object.values(series[expectedIdx].currencies).reduce((a, b) => a + b, 0);
    expect(bucketTotal).toBeGreaterThan(0);
  });

  it('groups currencies beyond top 5 into "other"', () => {
    const currencies = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const events = currencies.map((fc, i) =>
      makeEvent({ txHash: `TX${i}`, fromCurrency: fc, toCurrency: 'Z', xrpValue: '10', ledgerTime: new Date(now - 60_000).toISOString() })
    );
    const { series, topCurrencies } = aggregateBridgeEvents(events, '1h', now);
    expect(topCurrencies).toHaveLength(5);
    const anyBucketHasOther = series.some((b) => b.currencies['other'] > 0);
    expect(anyBucketHasOther).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd client && npx vitest run src/hooks/useBridgeHistory.test.js
```

Expected: FAIL — `aggregateBridgeEvents is not exported`

- [ ] **Step 4: Create `client/src/hooks/useBridgeHistory.js`**

```js
import { useQuery } from '@tanstack/react-query';
import { fetchBridgeEvents } from '../api/http';

const BUCKET_MS = { '10m': 30_000, '1h': 5 * 60_000, '24h': 60 * 60_000 };
const WINDOWS_MS = { '10m': 10 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 };
const TOP_N = 5;

export function aggregateBridgeEvents(events, timeWindow, now = Date.now()) {
  const bucketMs  = BUCKET_MS[timeWindow];
  const windowMs  = WINDOWS_MS[timeWindow];
  const windowStart = now - windowMs;
  const numBuckets  = Math.ceil(windowMs / bucketMs);

  const summary = {};
  const currencyTotals = {};

  for (const ev of events) {
    const xrp = parseFloat(ev.xrpValue) || 0;
    const { fromCurrency: fc, toCurrency: tc } = ev;
    summary[fc] = { fromVolume: (summary[fc]?.fromVolume ?? 0) + xrp, toVolume:  summary[fc]?.toVolume  ?? 0, count: (summary[fc]?.count ?? 0) + 1 };
    summary[tc] = { fromVolume:  summary[tc]?.fromVolume  ?? 0, toVolume:  (summary[tc]?.toVolume  ?? 0) + xrp, count: (summary[tc]?.count ?? 0) + 1 };
    currencyTotals[fc] = (currencyTotals[fc] ?? 0) + xrp;
    currencyTotals[tc] = (currencyTotals[tc] ?? 0) + xrp;
  }

  const topCurrencies = Object.entries(currencyTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([c]) => c);

  const seriesKeys = [...topCurrencies, 'other'];
  const series = Array.from({ length: numBuckets }, (_, i) => ({
    ts: windowStart + i * bucketMs,
    currencies: Object.fromEntries(seriesKeys.map((c) => [c, 0])),
  }));

  for (const ev of events) {
    const ts  = new Date(ev.ledgerTime).getTime();
    const idx = Math.floor((ts - windowStart) / bucketMs);
    if (idx < 0 || idx >= numBuckets) continue;
    const xrp = parseFloat(ev.xrpValue) || 0;
    for (const c of [ev.fromCurrency, ev.toCurrency]) {
      const key = topCurrencies.includes(c) ? c : 'other';
      series[idx].currencies[key] = (series[idx].currencies[key] ?? 0) + xrp / 2;
    }
  }

  return { summary, series, topCurrencies };
}

export function useBridgeHistory(timeWindow) {
  return useQuery({
    queryKey:        ['bridge-history', timeWindow],
    queryFn:         async () => {
      const { events } = await fetchBridgeEvents(timeWindow);
      const sorted = [...events].sort((a, b) => new Date(a.ledgerTime) - new Date(b.ledgerTime));
      const { summary, series, topCurrencies } = aggregateBridgeEvents(sorted, timeWindow);
      return { events: sorted, summary, series, topCurrencies };
    },
    refetchInterval: 30_000,
    staleTime:       15_000,
    enabled:         !!timeWindow,
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd client && npx vitest run src/hooks/useBridgeHistory.test.js
```

Expected: PASS (all 6 tests)

- [ ] **Step 6: Commit**

```bash
git add client/src/api/http.js client/src/hooks/useBridgeHistory.js client/src/hooks/useBridgeHistory.test.js
git commit -m "feat: useBridgeHistory hook with client-side aggregation"
```

---

### Task 6: BridgeView — window selector + mode switching

**Files:**
- Modify: `client/src/components/BridgeView.jsx`

This task adds the `viewWindow` state, wires `useBridgeHistory`, derives `activeStats` from either live or historical mode, and renders the window selector. No new visual components yet — just the data plumbing + toggle buttons.

- [ ] **Step 1: Add imports to BridgeView.jsx**

At the top of the file, add:

```js
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useBridgeHistory } from '../hooks/useBridgeHistory';
```

The full import block becomes:

```js
import { useEffect, useRef, useState } from 'react';
import { Box, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useBridgeStream } from '../hooks/useBridgeStream';
import { useBridgeHistory } from '../hooks/useBridgeHistory';
```

- [ ] **Step 2: Add state and history hook inside BridgeView**

Add these lines immediately after the existing `const [ringCurrencies, setRingCurrencies] = useState([]);` line:

```js
const [viewWindow, setViewWindow] = useState('live');

const isLive = viewWindow === 'live';
const historyQuery = useBridgeHistory(isLive ? null : viewWindow);
const historyData  = historyQuery.data;

const activeStats = isLive ? stats : (historyData?.summary ?? {});
```

- [ ] **Step 3: Update `maxVol` and `sortedStats` to use `activeStats`**

Find and replace:

```js
  const maxVol = positions.reduce((m, p) => {
    const s = stats[p.id];
    return Math.max(m, s?.fromVolume ?? 0, s?.toVolume ?? 0);
  }, 1);
```

With:

```js
  const maxVol = positions.reduce((m, p) => {
    const s = activeStats[p.id];
    return Math.max(m, s?.fromVolume ?? 0, s?.toVolume ?? 0);
  }, 1);
```

Find and replace:

```js
  const sortedStats = Object.entries(stats)
    .sort((a, b) => (b[1].fromVolume + b[1].toVolume) - (a[1].fromVolume + a[1].toVolume));
```

With:

```js
  const sortedStats = Object.entries(activeStats)
    .sort((a, b) => (b[1].fromVolume + b[1].toVolume) - (a[1].fromVolume + a[1].toVolume));
```

- [ ] **Step 4: Update weighted edges in SVG to use `activeStats`**

Inside the `<g id="edges">` block, find `const s = stats[p.id];` and replace with `const s = activeStats[p.id];`.

- [ ] **Step 5: Also update ringCurrencies effect to use `activeStats`**

Find:

```js
  useEffect(() => {
    setRingCurrencies((prev) => {
      const incoming = Object.keys(stats).filter((c) => !prev.includes(c));
      if (!incoming.length) return prev;
      return [...prev, ...incoming].slice(0, MAX_RING);
    });
  }, [stats]);
```

Replace with:

```js
  useEffect(() => {
    setRingCurrencies((prev) => {
      const incoming = Object.keys(activeStats).filter((c) => !prev.includes(c));
      if (!incoming.length) return prev;
      return [...prev, ...incoming].slice(0, MAX_RING);
    });
  }, [activeStats]);
```

- [ ] **Step 6: Add window selector to JSX**

In the return block, after the closing `</svg>` tag and before the stats table, add:

```jsx
      {/* Window selector */}
      <ToggleButtonGroup
        value={viewWindow}
        exclusive
        onChange={(_, v) => { if (v) { setViewWindow(v); setRingCurrencies([]); } }}
        size="small"
        sx={{ mb: 2, mt: 1 }}
      >
        {['live', '10m', '1h', '24h'].map((w) => (
          <ToggleButton key={w} value={w} sx={{ px: 2, fontSize: '0.7rem', textTransform: 'uppercase' }}>
            {w}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
```

Note: `setRingCurrencies([])` on window switch resets the ring so it rebuilds from the new window's currencies.

- [ ] **Step 7: Update the title text**

Find:

```jsx
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2, letterSpacing: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>
        XRP Bridge Utility — Live
      </Typography>
```

Replace with:

```jsx
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2, letterSpacing: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>
        XRP Bridge Utility — {viewWindow === 'live' ? 'Live' : `Last ${viewWindow}`}
      </Typography>
```

- [ ] **Step 8: Verify in browser**

Start the dev server if not running:
```bash
cd client && npm run dev
```

Open the Bridge tab. Verify:
- Toggle buttons `Live | 10m | 1h | 24h` appear below the ring
- Switching to `1h` fetches historical data and the ring redraws with historical weights
- Switching back to `Live` restores live mode
- Title updates accordingly

- [ ] **Step 9: Commit**

```bash
git add client/src/components/BridgeView.jsx
git commit -m "feat: bridge view window selector + live/historical mode switching"
```

---

### Task 7: BridgeView — sparkline SVG bar chart

**Files:**
- Modify: `client/src/components/BridgeView.jsx`

This task adds a stacked SVG bar chart below the window selector, visible only in historical mode.

- [ ] **Step 1: Add the `BridgeSparkline` function before the `BridgeView` export**

Insert this function between `flashArc` and `export function BridgeView()`:

```jsx
const CHART_W = 420, CHART_H = 72, CHART_PAD_B = 16;
const OTHER_COLOR = '#444e5a';

function BridgeSparkline({ series, topCurrencies, ringCurrencies, onSeek }) {
  if (!series?.length || !topCurrencies?.length) return null;

  const allKeys = [...topCurrencies, 'other'];
  const maxBucketTotal = Math.max(
    1,
    ...series.map((b) => allKeys.reduce((s, k) => s + (b.currencies[k] ?? 0), 0))
  );

  const barW  = Math.floor((CHART_W - 2) / series.length);
  const chartH = CHART_H - CHART_PAD_B;

  function colorFor_local(c) {
    return colorFor(c, ringCurrencies);
  }

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
                  fill={k === 'other' ? OTHER_COLOR : colorFor_local(k)}
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
```

- [ ] **Step 2: Add `onSeek` handler stub and wire the sparkline into JSX**

Inside `BridgeView`, after the `viewWindow` state declarations, add:

```js
  function handleSparklineSeek(ts) {
    // Replay seek is wired in Task 8; this is the hook point.
    console.log('[BRIDGE] Seek to', new Date(ts).toISOString());
  }
```

In the JSX, after the `</ToggleButtonGroup>` closing tag and before the stats table, add:

```jsx
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
```

- [ ] **Step 3: Verify in browser**

Switch to `1h` mode. The sparkline should appear as stacked colored bars with one bar per 5-minute bucket. Clicking a bar should log the seek timestamp to the browser console.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/BridgeView.jsx
git commit -m "feat: bridge sparkline stacked bar chart (top 5 currencies + other)"
```

---

### Task 8: BridgeView — replay controls

**Files:**
- Modify: `client/src/components/BridgeView.jsx`

This task adds play/pause/speed controls and the replay ticker. When playing, historical events are fed into `setQueue` paced by a `setInterval` that advances through the event list.

- [ ] **Step 1: Add replay state and refs inside `BridgeView`**

After the existing state declarations, add:

```js
  const [playing, setPlaying]     = useState(false);
  const [speed,   setSpeed]       = useState(10);   // multiplier: 1 | 10 | 50
  const replayRef                 = useRef(null);
  const replayIdxRef              = useRef(0);
  const replayEventsRef           = useRef([]);
```

- [ ] **Step 2: Add `startReplay`, `stopReplay`, and `seekReplay` functions inside `BridgeView`**

Add these after the state declarations:

```js
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

    const t0Events  = new Date(events[fromIdx]?.ledgerTime).getTime();
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
    const events = historyData.events;
    const idx    = events.findIndex((ev) => new Date(ev.ledgerTime).getTime() >= ts);
    const fromIdx = idx === -1 ? events.length - 1 : idx;
    if (playing) {
      startReplay(events, fromIdx, speed);
    } else {
      replayIdxRef.current    = fromIdx;
      replayEventsRef.current = events;
    }
  }
```

- [ ] **Step 3: Stop replay when switching windows**

Update the `onChange` handler in the `ToggleButtonGroup` to also stop replay:

```jsx
        onChange={(_, v) => {
          if (v) {
            stopReplay();
            setViewWindow(v);
            setRingCurrencies([]);
          }
        }}
```

- [ ] **Step 4: Update `handleSparklineSeek` to call `seekReplay`**

Replace the stub from Task 7:

```js
  function handleSparklineSeek(ts) {
    seekReplay(ts);
  }
```

- [ ] **Step 5: Add replay controls to JSX**

Insert after the `</Box>` that wraps the sparkline and before the stats table:

```jsx
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
            onChange={(_, v) => { if (v) { setSpeed(v); if (playing) startReplay(replayEventsRef.current, replayIdxRef.current, v); } }}
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
```

- [ ] **Step 6: Clean up replay on unmount**

Add a cleanup effect at the end of the component, before the return:

```js
  useEffect(() => () => clearInterval(replayRef.current), []);
```

- [ ] **Step 7: Verify replay in browser**

1. Switch to `1h` mode
2. Verify sparkline and replay controls appear
3. Click Play — particles should animate through historical events
4. Click Pause — animation stops
5. Click a sparkline bar — seek position updates; clicking Play from there replays from that bucket
6. Change speed to 50× — replay moves through events faster
7. Switch back to Live — controls disappear, live mode resumes

- [ ] **Step 8: Run the full client test suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add client/src/components/BridgeView.jsx
git commit -m "feat: bridge replay controls — play/pause/speed/seek"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| Redis sorted set `bridge:log` | Task 1 |
| recordBridgeEvent / getBridgeEvents / trimBridgeEvents | Task 1 |
| Unit + integration tests for Redis module | Tasks 1, 2 |
| Wire record + trim into ledgerProcessor | Task 3 |
| GET /bridge/events?window= endpoint | Task 4 |
| Mount /bridge router | Task 4 |
| fetchBridgeEvents in http.js | Task 5 |
| useBridgeHistory hook (fetch + aggregate) | Task 5 |
| summary same shape as useBridgeStream stats | Task 5 |
| series: top 5 + other, correct bucket counts | Task 5 |
| Window selector Live\|10m\|1h\|24h | Task 6 |
| Ring + table switch data source by mode | Task 6 |
| Ring resets on window switch | Task 6 |
| Sparkline stacked bar chart | Task 7 |
| Sparkline click → seek | Tasks 7, 8 |
| Play/Pause button | Task 8 |
| Speed selector 1×/10×/50× | Task 8 |
| Replay paces events into animation queue | Task 8 |
| Cleanup on unmount | Task 8 |
| Live mode unchanged | Tasks 6–8 (isLive guard) |

No gaps found.

**Placeholder scan:** No TBDs, no "handle edge cases", all code blocks complete.

**Type consistency:** `activeStats` shape `{ [currency]: { fromVolume, toVolume, count } }` matches `useBridgeStream` stats throughout. `series[i].currencies` uses string keys from `topCurrencies` + `'other'` consistently across Tasks 5, 7, 8.
