# XRP Direct Demand Timeseries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track direct XRP/IOU trades (excluding autobridging) as hourly Postgres buckets, expose them via REST + WebSocket, and display an animated ring visualization alongside the existing BridgeView in a renamed "XRP FLOW" tab.

**Architecture:** Fills whose transaction contains a detected autobridge are skipped; remaining XRP/IOU fills accumulate into `xrpDemandAcc` (keyed by hour+currency, issuers collapsed) and flush to Postgres on ledger close — identical to the bridge bucket pattern. A new `xrpl:xrp-demand` Redis pub/sub channel carries live events to the WebSocket server, which forwards them to clients. The client mirrors BridgeView exactly: `useXrpDemandStream` for live animation, `useXrpDemandHistory` for historical buckets, and `XrpDemandView` for the ring+sparkline+table UI.

**Tech Stack:** Node.js/Express, PostgreSQL (pg pool, upsert-accumulate), Redis pub/sub, React + MUI v7, Zustand, TanStack Query, Vitest (client), Jest (server)

---

## File Map

**Create (server):**
- `server/src/db/xrpDemandBuckets.js` — `upsertXrpDemandBuckets`, `queryXrpDemandBuckets`
- `server/src/api/xrpDemand.js` — Express router, `GET /xrp-demand/buckets`
- `server/tests/integration/xrpDemandBuckets.test.js` — integration tests

**Modify (server):**
- `server/schema.sql` — add `xrp_demand_hourly` table + index
- `server/src/redis/publisher.js` — add `publishXrpDemand`, `CHANNELS.XRP_DEMAND`
- `server/src/ingest/ledgerProcessor.js` — add `xrpDemandAcc`, detection + accumulation + publish
- `server/src/api/app.js` — mount `/xrp-demand` router
- `server/src/api/ws.js` — subscribe to `xrpl:xrp-demand` channel

**Create (client):**
- `client/src/hooks/useXrpDemandHistory.js` — `aggregateXrpDemandBuckets`, `useXrpDemandHistory`
- `client/src/hooks/useXrpDemandHistory.test.js` — unit tests
- `client/src/hooks/useXrpDemandStream.js` — `useXrpDemandStream`
- `client/src/components/XrpDemandView.jsx` — ring + sparkline + stats table

**Modify (client):**
- `client/src/api/http.js` — add `fetchXrpDemandBuckets`
- `client/src/store/useWsStore.js` — add `xrpDemands` array + `addXrpDemand` action
- `client/src/api/socket.js` — route `xrp-demand` messages to `store.addXrpDemand`
- `client/src/components/Dashboard.jsx` — side-by-side layout for `mode === 'xrp-flow'`
- `client/src/App.jsx` — rename `'bridge'` → `'xrp-flow'`, label "XRP FLOW"

---

## Task 1: Feature branch + DB schema

**Files:**
- Modify: `server/schema.sql`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/xrp-demand-timeseries
```

Expected: branch created and checked out.

- [ ] **Step 2: Add the schema**

Open `server/schema.sql`. Append after the `idx_bridge_buckets_hour` line:

```sql
CREATE TABLE IF NOT EXISTS xrp_demand_hourly (
    hour        TIMESTAMP NOT NULL,
    currency    VARCHAR(64) NOT NULL,
    xrp_bought  NUMERIC(38,18) NOT NULL DEFAULT 0,
    xrp_sold    NUMERIC(38,18) NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, currency)
);
CREATE INDEX IF NOT EXISTS idx_xrp_demand_hour ON xrp_demand_hourly (hour);
```

- [ ] **Step 3: Apply schema to running Postgres**

```bash
cd server && PGPASSWORD=xrplpass psql -h localhost -p 5434 -U xrpl -d xrpl_monitor \
  -c "CREATE TABLE IF NOT EXISTS xrp_demand_hourly (
        hour        TIMESTAMP NOT NULL,
        currency    VARCHAR(64) NOT NULL,
        xrp_bought  NUMERIC(38,18) NOT NULL DEFAULT 0,
        xrp_sold    NUMERIC(38,18) NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour, currency)
      );
      CREATE INDEX IF NOT EXISTS idx_xrp_demand_hour ON xrp_demand_hourly (hour);"
```

Expected: `CREATE TABLE` and `CREATE INDEX` output (or "already exists").

- [ ] **Step 4: Commit**

```bash
git add server/schema.sql
git commit -m "feat: add xrp_demand_hourly schema"
```

---

## Task 2: Server DB module — xrpDemandBuckets.js

**Files:**
- Create: `server/src/db/xrpDemandBuckets.js`
- Create: `server/tests/integration/xrpDemandBuckets.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `server/tests/integration/xrpDemandBuckets.test.js`:

```js
/**
 * Integration tests for xrp_demand_hourly DB writer.
 * Requires a running Postgres instance (via docker-compose).
 * Skips gracefully if DB is unavailable.
 * Run: cd server && PGPORT=5434 npx jest tests/integration/xrpDemandBuckets.test.js
 */
const { Pool } = require('pg');
const { upsertXrpDemandBuckets, queryXrpDemandBuckets } = require('../../src/db/xrpDemandBuckets');

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5434', 10),
  user:     process.env.PGUSER     || 'xrpl',
  password: process.env.PGPASSWORD || 'xrplpass',
  database: process.env.PGDATABASE || 'xrpl_monitor',
  connectionTimeoutMillis: 3000,
});

let dbAvailable = false;

beforeAll(async () => {
  try {
    await pool.query('SELECT 1');
    await pool.query('TRUNCATE TABLE xrp_demand_hourly');
    dbAvailable = true;
  } catch {
    console.warn('[INTEGRATION] Postgres unavailable — skipping xrpDemandBuckets tests');
  }
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  if (dbAvailable) await pool.query('TRUNCATE TABLE xrp_demand_hourly');
});

const HOUR      = new Date('2026-05-20T14:00:00Z');
const NEXT_HOUR = new Date('2026-05-20T15:00:00Z');

function makeRow(overrides = {}) {
  return { hour: HOUR, currency: 'USD', xrpBought: 100, xrpSold: 200, eventCount: 3, ...overrides };
}

describe('upsertXrpDemandBuckets', () => {
  it('inserts a new bucket row', async () => {
    if (!dbAvailable) return test.skip();
    await upsertXrpDemandBuckets(pool, [makeRow()]);
    const { rows } = await pool.query('SELECT * FROM xrp_demand_hourly');
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe('USD');
    expect(parseFloat(rows[0].xrp_bought)).toBeCloseTo(100);
    expect(parseFloat(rows[0].xrp_sold)).toBeCloseTo(200);
    expect(rows[0].event_count).toBe(3);
  });

  it('accumulates volumes on conflict (same bucket, second upsert)', async () => {
    if (!dbAvailable) return test.skip();
    await upsertXrpDemandBuckets(pool, [makeRow()]);
    await upsertXrpDemandBuckets(pool, [makeRow()]);
    const { rows } = await pool.query('SELECT * FROM xrp_demand_hourly');
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].xrp_bought)).toBeCloseTo(200);
    expect(parseFloat(rows[0].xrp_sold)).toBeCloseTo(400);
    expect(rows[0].event_count).toBe(6);
  });

  it('inserts multiple rows (different currencies) in one call', async () => {
    if (!dbAvailable) return test.skip();
    await upsertXrpDemandBuckets(pool, [
      makeRow({ currency: 'USD' }),
      makeRow({ currency: 'EUR', xrpBought: 50, xrpSold: 75 }),
    ]);
    const { rows } = await pool.query('SELECT * FROM xrp_demand_hourly ORDER BY currency');
    expect(rows).toHaveLength(2);
    expect(rows[0].currency).toBe('EUR');
    expect(rows[1].currency).toBe('USD');
  });

  it('is a no-op for an empty array', async () => {
    if (!dbAvailable) return test.skip();
    await expect(upsertXrpDemandBuckets(pool, [])).resolves.not.toThrow();
    const { rows } = await pool.query('SELECT * FROM xrp_demand_hourly');
    expect(rows).toHaveLength(0);
  });
});

describe('queryXrpDemandBuckets', () => {
  it('returns rows within the requested range', async () => {
    if (!dbAvailable) return test.skip();
    await upsertXrpDemandBuckets(pool, [
      makeRow({ hour: HOUR }),
      makeRow({ hour: NEXT_HOUR, currency: 'EUR' }),
    ]);
    const rows = await queryXrpDemandBuckets(pool, { from: HOUR, to: NEXT_HOUR });
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe('USD');
  });

  it('returns rows in ascending hour order', async () => {
    if (!dbAvailable) return test.skip();
    await upsertXrpDemandBuckets(pool, [
      makeRow({ hour: NEXT_HOUR }),
      makeRow({ hour: HOUR }),
    ]);
    const rows = await queryXrpDemandBuckets(pool, {
      from: HOUR, to: new Date('2026-05-20T16:00:00Z'),
    });
    expect(new Date(rows[0].hour).getTime()).toBeLessThan(new Date(rows[1].hour).getTime());
  });

  it('returns camelCase column aliases', async () => {
    if (!dbAvailable) return test.skip();
    await upsertXrpDemandBuckets(pool, [makeRow()]);
    const rows = await queryXrpDemandBuckets(pool, {
      from: HOUR, to: new Date('2026-05-20T16:00:00Z'),
    });
    expect(rows[0]).toHaveProperty('currency');
    expect(rows[0]).toHaveProperty('xrpBought');
    expect(rows[0]).toHaveProperty('xrpSold');
    expect(rows[0]).toHaveProperty('eventCount');
  });

  it('returns empty array when no rows in range', async () => {
    if (!dbAvailable) return test.skip();
    const rows = await queryXrpDemandBuckets(pool, { from: HOUR, to: NEXT_HOUR });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail with "Cannot find module"**

```bash
cd server && PGPORT=5434 npx jest tests/integration/xrpDemandBuckets.test.js --no-coverage 2>&1 | head -20
```

Expected: FAIL with `Cannot find module '../../src/db/xrpDemandBuckets'`.

- [ ] **Step 3: Create `server/src/db/xrpDemandBuckets.js`**

```js
const UPSERT_BUCKET = `
  INSERT INTO xrp_demand_hourly
    (hour, currency, xrp_bought, xrp_sold, event_count)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (hour, currency)
  DO UPDATE SET
    xrp_bought  = xrp_demand_hourly.xrp_bought  + EXCLUDED.xrp_bought,
    xrp_sold    = xrp_demand_hourly.xrp_sold    + EXCLUDED.xrp_sold,
    event_count = xrp_demand_hourly.event_count + EXCLUDED.event_count
`;

async function upsertXrpDemandBuckets(pool, rows) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(UPSERT_BUCKET, [
        row.hour,
        row.currency,
        row.xrpBought,
        row.xrpSold,
        row.eventCount,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

const QUERY_BUCKETS = `
  SELECT
    hour,
    currency,
    xrp_bought::text  AS "xrpBought",
    xrp_sold::text    AS "xrpSold",
    event_count       AS "eventCount"
  FROM xrp_demand_hourly
  WHERE hour >= $1 AND hour < $2
  ORDER BY hour ASC
`;

async function queryXrpDemandBuckets(pool, { from, to }) {
  const { rows } = await pool.query(QUERY_BUCKETS, [from, to]);
  return rows;
}

module.exports = { upsertXrpDemandBuckets, queryXrpDemandBuckets };
```

- [ ] **Step 4: Run tests — verify they pass (or skip if DB unavailable)**

```bash
cd server && PGPORT=5434 npx jest tests/integration/xrpDemandBuckets.test.js --no-coverage
```

Expected: PASS (or all tests skipped with "Postgres unavailable" warning if DB is down).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/xrpDemandBuckets.js server/tests/integration/xrpDemandBuckets.test.js
git commit -m "feat: add xrpDemandBuckets DB module + integration tests"
```

---

## Task 3: Server publisher — publishXrpDemand

**Files:**
- Modify: `server/src/redis/publisher.js`

- [ ] **Step 1: Add `XRP_DEMAND` channel and `publishXrpDemand` to publisher.js**

Open `server/src/redis/publisher.js`. Apply these changes:

```js
// Add to CHANNELS object:
const CHANNELS = {
  FILLS:        'fills',
  TOPK_CHANGED: 'topk:changed',
  BRIDGE:       'bridge:fill',
  XRP_DEMAND:   'xrpl:xrp-demand',           // ← add this line
  BOOK:         (pairKey) => `book:${pairKey}`,
};
```

Then add the builder function and publisher after `publishBridge`:

```js
function buildXrpDemandMessage(event) {
  return {
    type: 'xrp-demand',
    data: {
      currency:   event.currency,
      xrpBought:  String(event.xrpBought),
      xrpSold:    String(event.xrpSold),
      ledgerIndex: event.ledgerIndex,
    },
  };
}

async function publishXrpDemand(redis, event) {
  const msg = JSON.stringify(buildXrpDemandMessage(event));
  await redis.publish(CHANNELS.XRP_DEMAND, msg);
}
```

Add `buildXrpDemandMessage` and `publishXrpDemand` to the `module.exports`:

```js
module.exports = {
  CHANNELS,
  buildFillMessage,
  buildTopKChangedMessage,
  buildBridgeMessage,
  buildXrpDemandMessage,
  publishFill,
  publishTopKChanged,
  publishBridge,
  publishXrpDemand,
};
```

- [ ] **Step 2: Run existing server tests to confirm nothing broke**

```bash
cd server && npm test -- --testPathIgnorePatterns=integration --no-coverage 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/redis/publisher.js
git commit -m "feat: add publishXrpDemand to publisher"
```

---

## Task 4: Server ingest — XRP demand detection in ledgerProcessor.js

**Files:**
- Modify: `server/src/ingest/ledgerProcessor.js`

- [ ] **Step 1: Add import and `xrpDemandAcc` state**

Open `server/src/ingest/ledgerProcessor.js`.

At the top, add import alongside the existing bridge imports:

```js
const { upsertXrpDemandBuckets } = require('../db/xrpDemandBuckets');
const { publishXrpDemand }        = require('../redis/publisher');
```

Inside `createLedgerProcessor`, alongside `let bridgeAcc = new Map();`, add:

```js
let xrpDemandAcc = new Map();
```

- [ ] **Step 2: Add XRP demand detection inside `handleTransaction`**

In `handleTransaction`, after the existing bridge detection block (the `try { const bridges = detectBridges(fills); ... } catch` block), add a new try/catch block:

```js
try {
  const bridges = detectBridges(fills);
  // ... existing bridge accumulation code (leave untouched) ...
}

// NEW block — after the bridge try/catch:
try {
  if (detectBridges(fills).length === 0) {
    // No autobridging in this tx — capture direct XRP demand per currency
    const txDemand = new Map(); // currency -> { xrpBought, xrpSold, count }
    for (const f of fills) {
      let currency = null;
      let xrpBought = 0;
      let xrpSold   = 0;
      if (f.getsCurrency === 'XRP' && f.paysCurrency !== 'XRP') {
        currency  = f.paysCurrency;
        xrpBought = parseFloat(f.getsValue) || 0;
      } else if (f.paysCurrency === 'XRP' && f.getsCurrency !== 'XRP') {
        currency = f.getsCurrency;
        xrpSold  = parseFloat(f.paysValue) || 0;
      }
      if (!currency || currency === 'XRP') continue;
      const e = txDemand.get(currency) ?? { xrpBought: 0, xrpSold: 0, count: 0 };
      e.xrpBought += xrpBought;
      e.xrpSold   += xrpSold;
      e.count     += 1;
      txDemand.set(currency, e);
    }
    if (txDemand.size > 0) {
      const ledgerTime  = fills[0]?.ledgerTime;
      const ledgerIndex = fills[0]?.ledgerIndex;
      const hour        = truncateToHour(ledgerTime);
      for (const [currency, { xrpBought, xrpSold, count }] of txDemand) {
        if (xrpBought === 0 && xrpSold === 0) continue;
        publishXrpDemand(redis, { currency, xrpBought, xrpSold, ledgerIndex }).catch((err) => {
          console.error('[XRP_DEMAND] Failed to publish:', err.message);
        });
        const key   = `${hour.toISOString()}:${currency}`;
        const entry = xrpDemandAcc.get(key) ?? { hour, currency, xrpBought: 0, xrpSold: 0, eventCount: 0 };
        entry.xrpBought += xrpBought;
        entry.xrpSold   += xrpSold;
        entry.eventCount += count;
        xrpDemandAcc.set(key, entry);
      }
    }
  }
} catch (err) {
  console.error('[XRP_DEMAND] Detection error:', err.message);
}
```

**Important:** `detectBridges` is called a second time here. This is a cheap call on the same `fills` array already in scope. Avoid passing a cached result from the bridge block — that block's catch may have swallowed errors, and this ensures correctness.

- [ ] **Step 3: Flush `xrpDemandAcc` on ledger close**

In `handleLedgerClosed`, alongside the existing `bridgeAcc` flush:

```js
// Existing bridge flush (leave untouched):
if (bridgeAcc.size > 0) {
  const rows = [...bridgeAcc.values()];
  bridgeAcc.clear();
  upsertBridgeBuckets(pool, rows).catch((err) => {
    console.error('[BRIDGE] Failed to upsert bridge buckets:', err.message);
  });
}

// Add immediately after:
if (xrpDemandAcc.size > 0) {
  const rows = [...xrpDemandAcc.values()];
  xrpDemandAcc.clear();
  upsertXrpDemandBuckets(pool, rows).catch((err) => {
    console.error('[XRP_DEMAND] Failed to upsert demand buckets:', err.message);
  });
}
```

- [ ] **Step 4: Run existing server tests to confirm nothing broke**

```bash
cd server && npm test -- --testPathIgnorePatterns=integration --no-coverage 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/ingest/ledgerProcessor.js
git commit -m "feat: detect and accumulate direct XRP demand in ledgerProcessor"
```

---

## Task 5: Server API router + app mount + WS subscribe

**Files:**
- Create: `server/src/api/xrpDemand.js`
- Modify: `server/src/api/app.js`
- Modify: `server/src/api/ws.js`

- [ ] **Step 1: Create `server/src/api/xrpDemand.js`**

```js
const { Router } = require('express');
const { queryXrpDemandBuckets } = require('../db/xrpDemandBuckets');

function createXrpDemandRouter({ pool }) {
  const router = Router();

  router.get('/buckets', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'Both "from" and "to" query params are required (ISO 8601)' });
    }
    const fromDate = new Date(from);
    const toDate   = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate >= toDate) {
      return res.status(400).json({ error: '"from" and "to" must be valid ISO 8601 timestamps with from < to' });
    }
    try {
      const buckets = await queryXrpDemandBuckets(pool, { from: fromDate, to: toDate });
      res.json({ from, to, buckets });
    } catch (err) {
      console.error('[XRP_DEMAND/BUCKETS] Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createXrpDemandRouter };
```

- [ ] **Step 2: Mount the router in `server/src/api/app.js`**

Add import at the top:

```js
const { createXrpDemandRouter } = require('./xrpDemand');
```

Add mount in `createApp`:

```js
app.use('/xrp-demand', createXrpDemandRouter({ pool }));
```

The full `createApp` function should now look like:

```js
function createApp({ pool, redis, state, xrplClient, pairRegistry }) {
  const app = express();
  app.use(express.json());

  app.use('/health',     createHealthRouter({ state, pool, redis }));
  app.use('/book',       createBookRouter({ redis, xrplClient, pairRegistry }));
  app.use('/fills',      createFillsRouter({ pool, redis }));
  app.use('/amm',        createAmmRouter({ redis }));
  app.use('/ledger',     createLedgerRouter({ redis }));
  app.use('/bridge',     createBridgeRouter({ pool }));
  app.use('/xrp-demand', createXrpDemandRouter({ pool }));

  return app;
}
```

- [ ] **Step 3: Subscribe to `xrpl:xrp-demand` in `server/src/api/ws.js`**

In `ws.js`, `CHANNELS.XRP_DEMAND` is now exported from publisher. Update the subscribed channels array:

```js
const SUBSCRIBED_CHANNELS = [CHANNELS.FILLS, CHANNELS.TOPK_CHANGED, CHANNELS.BRIDGE, CHANNELS.XRP_DEMAND];
```

Also update the `unsubscribe` call in `close()`:

```js
await subscriber.unsubscribe(...SUBSCRIBED_CHANNELS).catch(() => {});
```

(This already uses the spread, so it will include XRP_DEMAND automatically once the array is updated.)

- [ ] **Step 4: Run existing server tests to confirm nothing broke**

```bash
cd server && npm test -- --testPathIgnorePatterns=integration --no-coverage 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/xrpDemand.js server/src/api/app.js server/src/api/ws.js
git commit -m "feat: add xrp-demand REST router and WS subscription"
```

---

## Task 6: Client HTTP + WS store + socket routing

**Files:**
- Modify: `client/src/api/http.js`
- Modify: `client/src/store/useWsStore.js`
- Modify: `client/src/api/socket.js`

- [ ] **Step 1: Add `fetchXrpDemandBuckets` to `client/src/api/http.js`**

Append at the end of the file:

```js
export function fetchXrpDemandBuckets(from, to) {
  return api.get('/xrp-demand/buckets', { params: { from, to } }).then((r) => r.data);
}
```

- [ ] **Step 2: Add `xrpDemands` to `client/src/store/useWsStore.js`**

In the `create((set) => ({` object, alongside `bridges: []`, add:

```js
xrpDemands: [],
```

After the `addBridge` action, add:

```js
addXrpDemand: (event) =>
  set((s) => ({ xrpDemands: [event, ...s.xrpDemands].slice(0, 200) })),
```

- [ ] **Step 3: Route `xrp-demand` messages in `client/src/api/socket.js`**

In the `ws.onmessage` handler, after `if (msg.type === 'bridge:fill') store.addBridge(msg.data);`, add:

```js
if (msg.type === 'xrp-demand') store.addXrpDemand(msg.data);
```

- [ ] **Step 4: Run existing client tests to confirm nothing broke**

```bash
cd client && npm test -- --run 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/http.js client/src/store/useWsStore.js client/src/api/socket.js
git commit -m "feat: wire xrp-demand WS events through client store"
```

---

## Task 7: Client hook — useXrpDemandHistory + unit tests

**Files:**
- Create: `client/src/hooks/useXrpDemandHistory.js`
- Create: `client/src/hooks/useXrpDemandHistory.test.js`

- [ ] **Step 1: Write the failing unit tests**

Create `client/src/hooks/useXrpDemandHistory.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { aggregateXrpDemandBuckets, BUCKET_MS, WINDOWS_MS } from './useXrpDemandHistory';

function makeBucket(overrides = {}) {
  return {
    hour:       new Date().toISOString(),
    currency:   'USD',
    xrpBought:  '500',
    xrpSold:    '700',
    eventCount: 2,
    ...overrides,
  };
}

describe('aggregateXrpDemandBuckets', () => {
  const now = Date.now();

  it('builds summary with bought, sold, balance, count per currency', () => {
    const buckets = [makeBucket({ hour: new Date(now - 60_000).toISOString() })];
    const { summary } = aggregateXrpDemandBuckets(buckets, '1h', now);
    expect(summary['USD'].bought).toBeCloseTo(500);
    expect(summary['USD'].sold).toBeCloseTo(700);
    expect(summary['USD'].balance).toBeCloseTo(-200);
    expect(summary['USD'].count).toBe(2);
  });

  it('accumulates multiple buckets for the same currency', () => {
    const buckets = [
      makeBucket({ hour: new Date(now - 60 * 60_000).toISOString(), xrpBought: '100', xrpSold: '200' }),
      makeBucket({ hour: new Date(now - 30 * 60_000).toISOString(), xrpBought: '400', xrpSold: '300' }),
    ];
    const { summary } = aggregateXrpDemandBuckets(buckets, '24h', now);
    expect(summary['USD'].bought).toBeCloseTo(500);
    expect(summary['USD'].sold).toBeCloseTo(500);
    expect(summary['USD'].balance).toBeCloseTo(0);
    expect(summary['USD'].count).toBe(4);
  });

  it('returns topCurrencies sorted by total volume (bought+sold) descending, max 5', () => {
    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'];
    const buckets = currencies.map((c, i) =>
      makeBucket({
        hour: new Date(now - 60_000).toISOString(),
        currency: c,
        xrpBought: String((6 - i) * 100),
        xrpSold:   String((6 - i) * 50),
        eventCount: 1,
      })
    );
    const { topCurrencies } = aggregateXrpDemandBuckets(buckets, '24h', now);
    expect(topCurrencies).toHaveLength(5);
    expect(topCurrencies[0]).toBe('USD');
    expect(topCurrencies).not.toContain('ETH');
  });

  it('returns correct number of chart buckets for each window', () => {
    const b = makeBucket({ hour: new Date(now - 60_000).toISOString() });
    expect(aggregateXrpDemandBuckets([b], '10m', now).series).toHaveLength(20);
    expect(aggregateXrpDemandBuckets([b], '1h',  now).series).toHaveLength(12);
    expect(aggregateXrpDemandBuckets([b], '24h', now).series).toHaveLength(24);
  });

  it('places bucket volume (bought+sold) in the correct chart slot', () => {
    const bucketMs   = BUCKET_MS['24h'];
    const windowMs   = WINDOWS_MS['24h'];
    const windowStart = now - windowMs;
    const ts = now - 3 * 60 * 60_000;
    const expectedIdx = Math.floor((ts - windowStart) / bucketMs);
    const b = makeBucket({ hour: new Date(ts).toISOString(), xrpBought: '300', xrpSold: '200' });
    const { series } = aggregateXrpDemandBuckets([b], '24h', now);
    const total = Object.values(series[expectedIdx].currencies).reduce((a, v) => a + v, 0);
    expect(total).toBeCloseTo(500);
  });

  it('groups currencies beyond top 5 into "other"', () => {
    const currencies = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const buckets = currencies.map((c) =>
      makeBucket({ hour: new Date(now - 60_000).toISOString(), currency: c, xrpBought: '100', xrpSold: '50', eventCount: 1 })
    );
    const { series, topCurrencies } = aggregateXrpDemandBuckets(buckets, '24h', now);
    expect(topCurrencies).toHaveLength(5);
    const anyBucketHasOther = series.some((b) => b.currencies['other'] > 0);
    expect(anyBucketHasOther).toBe(true);
  });

  it('throws for unknown timeWindow', () => {
    expect(() => aggregateXrpDemandBuckets([], '7d')).toThrow('Unknown timeWindow');
  });

  it('returns bought-only bucket correctly (balance = bought)', () => {
    const buckets = [makeBucket({ hour: new Date(now - 60_000).toISOString(), xrpBought: '1000', xrpSold: '0' })];
    const { summary } = aggregateXrpDemandBuckets(buckets, '1h', now);
    expect(summary['USD'].balance).toBeCloseTo(1000);
    expect(summary['USD'].sold).toBeCloseTo(0);
  });

  it('returns sold-only bucket correctly (balance = -sold)', () => {
    const buckets = [makeBucket({ hour: new Date(now - 60_000).toISOString(), xrpBought: '0', xrpSold: '500' })];
    const { summary } = aggregateXrpDemandBuckets(buckets, '1h', now);
    expect(summary['USD'].balance).toBeCloseTo(-500);
    expect(summary['USD'].bought).toBeCloseTo(0);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail with "Cannot find module"**

```bash
cd client && npm test -- --run useXrpDemandHistory 2>&1 | head -20
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Create `client/src/hooks/useXrpDemandHistory.js`**

```js
import { useQuery } from '@tanstack/react-query';
import { fetchXrpDemandBuckets } from '../api/http';

export const BUCKET_MS  = { '10m': 30_000,       '1h': 5 * 60_000,     '24h': 60 * 60_000 };
export const WINDOWS_MS = { '10m': 10 * 60_000,   '1h': 60 * 60_000,    '24h': 24 * 60 * 60_000 };
const TOP_N = 5;

export function aggregateXrpDemandBuckets(buckets, timeWindow, now = Date.now()) {
  if (!BUCKET_MS[timeWindow] || !WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
  const bucketMs    = BUCKET_MS[timeWindow];
  const windowMs    = WINDOWS_MS[timeWindow];
  const windowStart = now - windowMs;
  const numBuckets  = Math.ceil(windowMs / bucketMs);

  const summary        = {};
  const currencyTotals = {};

  for (const b of buckets) {
    const bought = parseFloat(b.xrpBought) || 0;
    const sold   = parseFloat(b.xrpSold)   || 0;
    const total  = bought + sold;
    const { currency, eventCount } = b;
    const prev = summary[currency] ?? { bought: 0, sold: 0, count: 0 };
    summary[currency] = {
      bought: prev.bought + bought,
      sold:   prev.sold   + sold,
      count:  prev.count  + eventCount,
    };
    currencyTotals[currency] = (currencyTotals[currency] ?? 0) + total;
  }

  for (const c of Object.keys(summary)) {
    summary[c].balance = summary[c].bought - summary[c].sold;
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

  for (const b of buckets) {
    const ts    = new Date(b.hour).getTime();
    const total = (parseFloat(b.xrpBought) || 0) + (parseFloat(b.xrpSold) || 0);
    const idx   = Math.floor((ts - windowStart) / bucketMs);
    if (idx < 0 || idx >= numBuckets) continue;
    const key = topCurrencies.includes(b.currency) ? b.currency : 'other';
    series[idx].currencies[key] = (series[idx].currencies[key] ?? 0) + total;
  }

  return { summary, series, topCurrencies };
}

export function useXrpDemandHistory(timeWindow) {
  return useQuery({
    queryKey:        ['xrp-demand-history', timeWindow],
    queryFn:         async () => {
      if (!WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
      const to   = new Date().toISOString();
      const from = new Date(Date.now() - WINDOWS_MS[timeWindow]).toISOString();
      const { buckets } = await fetchXrpDemandBuckets(from, to);
      return aggregateXrpDemandBuckets(buckets, timeWindow);
    },
    refetchInterval: 30_000,
    staleTime:       15_000,
    enabled:         !!timeWindow,
  });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd client && npm test -- --run useXrpDemandHistory 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useXrpDemandHistory.js client/src/hooks/useXrpDemandHistory.test.js
git commit -m "feat: add useXrpDemandHistory hook + unit tests"
```

---

## Task 8: Client hook — useXrpDemandStream

**Files:**
- Create: `client/src/hooks/useXrpDemandStream.js`

- [ ] **Step 1: Create `client/src/hooks/useXrpDemandStream.js`**

```js
import { useEffect, useRef, useState } from 'react';
import { useWsStore } from '../store/useWsStore';

export function useXrpDemandStream() {
  const xrpDemands = useWsStore((s) => s.xrpDemands);
  const seenRef    = useRef(new Set());

  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState({}); // { [currency]: { bought, sold, balance, count } }

  useEffect(() => {
    const newItems = [];

    for (const event of [...xrpDemands].reverse()) {
      // Deduplicate by ledgerIndex + currency + amounts (no txHash available)
      const key = `${event.ledgerIndex}:${event.currency}:${event.xrpBought}:${event.xrpSold}`;
      if (seenRef.current.has(key)) continue;
      seenRef.current.add(key);
      if (seenRef.current.size > 200) {
        const oldest = seenRef.current.values().next().value;
        seenRef.current.delete(oldest);
      }
      newItems.push(event);
    }

    if (!newItems.length) return;

    setStats((prev) => {
      const next = { ...prev };
      for (const event of newItems) {
        const { currency } = event;
        const bought = parseFloat(event.xrpBought) || 0;
        const sold   = parseFloat(event.xrpSold)   || 0;
        const p      = next[currency] ?? { bought: 0, sold: 0, balance: 0, count: 0 };
        next[currency] = {
          bought:  p.bought  + bought,
          sold:    p.sold    + sold,
          balance: p.balance + bought - sold,
          count:   p.count   + 1,
        };
      }
      return next;
    });

    const queueItems = [];
    for (const event of newItems) {
      const bought = parseFloat(event.xrpBought) || 0;
      const sold   = parseFloat(event.xrpSold)   || 0;
      if (bought > 0) queueItems.push({ currency: event.currency, direction: 'buy' });
      if (sold   > 0) queueItems.push({ currency: event.currency, direction: 'sell' });
    }
    setQueue((prev) => [...prev, ...queueItems]);
  }, [xrpDemands]);

  return { queue, setQueue, stats };
}
```

- [ ] **Step 2: Run all client tests**

```bash
cd client && npm test -- --run 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useXrpDemandStream.js
git commit -m "feat: add useXrpDemandStream hook"
```

---

## Task 9: Client component — XrpDemandView.jsx

**Files:**
- Create: `client/src/components/XrpDemandView.jsx`

- [ ] **Step 1: Create `client/src/components/XrpDemandView.jsx`**

```jsx
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
        svgEl.removeChild(path);
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
```

- [ ] **Step 2: Run all client tests**

```bash
cd client && npm test -- --run 2>&1 | tail -15
```

Expected: all tests PASS (XrpDemandView has no unit tests — it's a pure UI component tested manually).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/XrpDemandView.jsx
git commit -m "feat: add XrpDemandView component"
```

---

## Task 10: Dashboard + App wiring

**Files:**
- Modify: `client/src/components/Dashboard.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Update `client/src/components/Dashboard.jsx`**

Add the import at the top:

```js
import { XrpDemandView } from './XrpDemandView';
```

Replace the `mode === 'bridge'` branch:

```jsx
// Remove this:
if (mode === 'bridge') {
  return (
    <Box sx={{ flex: 1, p: 1.5, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
      <BridgeView />
    </Box>
  );
}

// Replace with:
if (mode === 'xrp-flow') {
  return (
    <Box sx={{ flex: 1, p: 1.5, minHeight: 0, overflow: 'auto', display: 'flex', gap: 1.5, justifyContent: 'center' }}>
      <BridgeView />
      <XrpDemandView />
    </Box>
  );
}
```

- [ ] **Step 2: Update `client/src/App.jsx`**

Change the `MODES` array from:

```js
const MODES = ['iou', 'mpt', 'amm', 'ledger', 'bridge'];
```

To:

```js
const MODES = ['iou', 'mpt', 'amm', 'ledger', 'xrp-flow'];
```

The tab button label is derived from `m.toUpperCase()` — `'xrp-flow'.toUpperCase()` renders as `"XRP-FLOW"`. To display `"XRP FLOW"`, add a label map:

```js
const MODE_LABELS = { 'xrp-flow': 'XRP FLOW' };
```

Then update the ToggleButton render:

```jsx
{MODES.map((m) => (
  <ToggleButton key={m} value={m} sx={{ fontSize: '0.65rem', px: 1.5, py: 0, letterSpacing: 0.5 }}>
    {MODE_LABELS[m] ?? m.toUpperCase()}
  </ToggleButton>
))}
```

- [ ] **Step 3: Run all client tests**

```bash
cd client && npm test -- --run 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 4: Run all server tests**

```bash
cd server && npm test -- --testPathIgnorePatterns=integration --no-coverage 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Dashboard.jsx client/src/App.jsx
git commit -m "feat: rename bridge tab to XRP FLOW, show BridgeView + XrpDemandView side by side"
```

---

## Done

At this point all tasks are complete. Verify the full implementation:

1. Start the app: `./start.sh`
2. Open `http://localhost:3000`
3. Click the **XRP FLOW** tab — both BridgeView and XrpDemandView appear side by side
4. Wait for live XRP trades — the XrpDemandView ring should animate with currency→XRP (buy) and XRP→currency (sell) particles
5. Switch to **10m / 1h / 24h** windows — sparkline and stats table populate from Postgres buckets
6. Verify BridgeView still works identically on the left panel
