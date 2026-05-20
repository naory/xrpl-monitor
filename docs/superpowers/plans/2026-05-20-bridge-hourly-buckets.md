# Bridge Hourly Buckets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist XRP autobridging timeseries data to Postgres as hourly buckets so data survives server restarts, and wire the client to read from Postgres instead of Redis.

**Architecture:** On every bridge event detected during a ledger, accumulate volumes in an in-memory Map keyed by `(hour, fromCurrency, fromIssuer, toCurrency, toIssuer)`. On ledger close, batch-upsert the accumulated Map into a new `bridge_hourly_buckets` Postgres table and clear the Map. Replace the existing Redis sorted-set log (`bridge:log`) with this Postgres store. The client hook switches from `GET /bridge/events` (Redis) to `GET /bridge/buckets` (Postgres). Replay controls are removed from historical mode since individual event timestamps are no longer stored.

**Tech Stack:** Node.js, Express, `pg` (Pool), PostgreSQL, React, `@tanstack/react-query`, Jest (server), Vitest (client)

---

## File Map

| File | Action |
|---|---|
| `server/schema.sql` | Add `bridge_hourly_buckets` table + index |
| `server/src/db/bridgeBuckets.js` | New — `upsertBridgeBuckets`, `queryBridgeBuckets` |
| `server/tests/integration/bridgeBuckets.test.js` | New — integration tests for DB layer |
| `server/tests/integration/bridgeTimeseries.test.js` | Delete — tests functions being removed |
| `server/src/ingest/ledgerProcessor.js` | Add `bridgeAcc` accumulator + ledger-close flush; remove Redis bridge log calls |
| `server/src/redis/bridgeTimeseries.js` | Remove `recordBridgeEvent`, `getBridgeEvents`, `trimBridgeEvents`, `LOG_KEY`; keep `WINDOWS`, `BUCKET_MS` |
| `server/src/api/bridge.js` | Replace `GET /bridge/events` with `GET /bridge/buckets`; accept `pool` not `redis` |
| `server/src/api/app.js` | Pass `pool` to `createBridgeRouter` |
| `client/src/api/http.js` | Replace `fetchBridgeEvents` with `fetchBridgeBuckets` |
| `client/src/hooks/useBridgeHistory.js` | Replace `aggregateBridgeEvents` with `aggregateBridgeBuckets`; update hook |
| `client/src/hooks/useBridgeHistory.test.js` | Update tests to cover `aggregateBridgeBuckets` |
| `client/src/components/BridgeView.jsx` | Remove replay controls + state; guard `historyData` references |

---

## Task 1: Create Feature Branch

- [ ] **Step 1.1: Create and check out branch**

```bash
git checkout -b feat/bridge-hourly-buckets
```

Expected: `Switched to a new branch 'feat/bridge-hourly-buckets'`

---

## Task 2: Write Failing Integration Test for bridgeBuckets DB Layer

Write the test first. It will fail because the table and module don't exist yet.

**Files:**
- Create: `server/tests/integration/bridgeBuckets.test.js`

- [ ] **Step 2.1: Create the integration test**

Create `server/tests/integration/bridgeBuckets.test.js`:

```js
/**
 * Integration tests for bridge_hourly_buckets DB writer.
 * Requires a running Postgres instance (via docker-compose).
 * Skips gracefully if DB is unavailable.
 * Run: cd server && PGPORT=5434 npx jest tests/integration/bridgeBuckets.test.js
 */
const { Pool } = require('pg');
const { upsertBridgeBuckets, queryBridgeBuckets } = require('../../src/db/bridgeBuckets');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5434', 10),
  user: process.env.PGUSER || 'xrpl',
  password: process.env.PGPASSWORD || 'xrplpass',
  database: process.env.PGDATABASE || 'xrpl_monitor',
  connectionTimeoutMillis: 3000,
});

let dbAvailable = false;

beforeAll(async () => {
  try {
    await pool.query('SELECT 1');
    await pool.query('TRUNCATE TABLE bridge_hourly_buckets');
    dbAvailable = true;
  } catch {
    console.warn('[INTEGRATION] Postgres unavailable — skipping bridgeBuckets tests');
  }
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  if (dbAvailable) await pool.query('TRUNCATE TABLE bridge_hourly_buckets');
});

const HOUR = new Date('2026-05-20T14:00:00Z');
const NEXT_HOUR = new Date('2026-05-20T15:00:00Z');

function makeRow(overrides = {}) {
  return {
    hour:         HOUR,
    fromCurrency: 'USD',
    fromIssuer:   'rIssuer1',
    toCurrency:   'EUR',
    toIssuer:     'rIssuer2',
    fromVolume:   100,
    toVolume:     92,
    xrpVolume:    205,
    eventCount:   3,
    ...overrides,
  };
}

describe('upsertBridgeBuckets', () => {
  it('inserts a new bucket row', async () => {
    if (!dbAvailable) return;

    await upsertBridgeBuckets(pool, [makeRow()]);

    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets');
    expect(rows).toHaveLength(1);
    expect(rows[0].from_currency).toBe('USD');
    expect(parseFloat(rows[0].xrp_volume)).toBeCloseTo(205);
    expect(rows[0].event_count).toBe(3);
  });

  it('accumulates volumes on conflict (same bucket, second upsert)', async () => {
    if (!dbAvailable) return;

    await upsertBridgeBuckets(pool, [makeRow()]);
    await upsertBridgeBuckets(pool, [makeRow()]);

    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets');
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].xrp_volume)).toBeCloseTo(410);
    expect(rows[0].event_count).toBe(6);
  });

  it('inserts multiple rows in one call', async () => {
    if (!dbAvailable) return;

    await upsertBridgeBuckets(pool, [
      makeRow({ fromCurrency: 'USD', toCurrency: 'EUR' }),
      makeRow({ fromCurrency: 'BTC', toCurrency: 'USD', fromIssuer: '', toIssuer: 'rIssuer1' }),
    ]);

    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets ORDER BY from_currency');
    expect(rows).toHaveLength(2);
    expect(rows[0].from_currency).toBe('BTC');
    expect(rows[1].from_currency).toBe('USD');
  });

  it('is a no-op for an empty array', async () => {
    if (!dbAvailable) return;
    await expect(upsertBridgeBuckets(pool, [])).resolves.not.toThrow();
    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets');
    expect(rows).toHaveLength(0);
  });

  it('handles XRP issuers stored as empty string', async () => {
    if (!dbAvailable) return;

    await upsertBridgeBuckets(pool, [makeRow({ fromIssuer: '', toIssuer: '' })]);
    const { rows } = await pool.query('SELECT * FROM bridge_hourly_buckets');
    expect(rows[0].from_issuer).toBe('');
    expect(rows[0].to_issuer).toBe('');
  });
});

describe('queryBridgeBuckets', () => {
  it('returns rows within the requested range', async () => {
    if (!dbAvailable) return;

    await upsertBridgeBuckets(pool, [
      makeRow({ hour: HOUR }),
      makeRow({ hour: NEXT_HOUR, fromCurrency: 'BTC', fromIssuer: '' }),
    ]);

    const rows = await queryBridgeBuckets(pool, { from: HOUR, to: NEXT_HOUR });
    expect(rows).toHaveLength(1);
    expect(rows[0].fromCurrency).toBe('USD');
  });

  it('returns rows in ascending hour order', async () => {
    if (!dbAvailable) return;

    await upsertBridgeBuckets(pool, [
      makeRow({ hour: NEXT_HOUR }),
      makeRow({ hour: HOUR }),
    ]);

    const rows = await queryBridgeBuckets(pool, {
      from: HOUR,
      to: new Date('2026-05-20T16:00:00Z'),
    });
    expect(new Date(rows[0].hour).getTime()).toBeLessThan(new Date(rows[1].hour).getTime());
  });

  it('returns camelCase column aliases', async () => {
    if (!dbAvailable) return;

    await upsertBridgeBuckets(pool, [makeRow()]);
    const rows = await queryBridgeBuckets(pool, {
      from: HOUR,
      to: new Date('2026-05-20T16:00:00Z'),
    });
    expect(rows[0]).toHaveProperty('fromCurrency');
    expect(rows[0]).toHaveProperty('fromIssuer');
    expect(rows[0]).toHaveProperty('xrpVolume');
    expect(rows[0]).toHaveProperty('eventCount');
  });

  it('returns empty array when no rows in range', async () => {
    if (!dbAvailable) return;
    const rows = await queryBridgeBuckets(pool, { from: HOUR, to: NEXT_HOUR });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/server && PGPORT=5434 npx jest tests/integration/bridgeBuckets.test.js --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../src/db/bridgeBuckets'`

---

## Task 3: Add Schema + Apply to Dev DB

**Files:**
- Modify: `server/schema.sql`

- [ ] **Step 3.1: Add the new table to schema.sql**

Append to the end of `server/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS bridge_hourly_buckets (
    hour          TIMESTAMP NOT NULL,
    from_currency VARCHAR(64) NOT NULL,
    from_issuer   VARCHAR(64) NOT NULL DEFAULT '',
    to_currency   VARCHAR(64) NOT NULL,
    to_issuer     VARCHAR(64) NOT NULL DEFAULT '',
    from_volume   NUMERIC(38, 18) NOT NULL DEFAULT 0,
    to_volume     NUMERIC(38, 18) NOT NULL DEFAULT 0,
    xrp_volume    NUMERIC(38, 18) NOT NULL DEFAULT 0,
    event_count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, from_currency, from_issuer, to_currency, to_issuer)
);
CREATE INDEX IF NOT EXISTS idx_bridge_buckets_hour ON bridge_hourly_buckets (hour);
```

- [ ] **Step 3.2: Apply the new table to the running dev DB**

```bash
PGPASSWORD=xrplpass psql -h localhost -p 5434 -U xrpl -d xrpl_monitor \
  -c "CREATE TABLE IF NOT EXISTS bridge_hourly_buckets (
    hour TIMESTAMP NOT NULL, from_currency VARCHAR(64) NOT NULL,
    from_issuer VARCHAR(64) NOT NULL DEFAULT '', to_currency VARCHAR(64) NOT NULL,
    to_issuer VARCHAR(64) NOT NULL DEFAULT '', from_volume NUMERIC(38,18) NOT NULL DEFAULT 0,
    to_volume NUMERIC(38,18) NOT NULL DEFAULT 0, xrp_volume NUMERIC(38,18) NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, from_currency, from_issuer, to_currency, to_issuer)
  ); CREATE INDEX IF NOT EXISTS idx_bridge_buckets_hour ON bridge_hourly_buckets (hour);"
```

Expected: `CREATE TABLE` / `CREATE INDEX`

---

## Task 4: Implement bridgeBuckets.js

**Files:**
- Create: `server/src/db/bridgeBuckets.js`

- [ ] **Step 4.1: Write the module**

Create `server/src/db/bridgeBuckets.js`:

```js
const UPSERT_BUCKET = `
  INSERT INTO bridge_hourly_buckets
    (hour, from_currency, from_issuer, to_currency, to_issuer,
     from_volume, to_volume, xrp_volume, event_count)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (hour, from_currency, from_issuer, to_currency, to_issuer)
  DO UPDATE SET
    from_volume  = bridge_hourly_buckets.from_volume  + EXCLUDED.from_volume,
    to_volume    = bridge_hourly_buckets.to_volume    + EXCLUDED.to_volume,
    xrp_volume   = bridge_hourly_buckets.xrp_volume   + EXCLUDED.xrp_volume,
    event_count  = bridge_hourly_buckets.event_count  + EXCLUDED.event_count
`;

async function upsertBridgeBuckets(pool, rows) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(UPSERT_BUCKET, [
        row.hour,
        row.fromCurrency,
        row.fromIssuer,
        row.toCurrency,
        row.toIssuer,
        row.fromVolume,
        row.toVolume,
        row.xrpVolume,
        row.eventCount,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const QUERY_BUCKETS = `
  SELECT
    hour,
    from_currency AS "fromCurrency",
    from_issuer   AS "fromIssuer",
    to_currency   AS "toCurrency",
    to_issuer     AS "toIssuer",
    from_volume::text AS "fromVolume",
    to_volume::text   AS "toVolume",
    xrp_volume::text  AS "xrpVolume",
    event_count       AS "eventCount"
  FROM bridge_hourly_buckets
  WHERE hour >= $1 AND hour < $2
  ORDER BY hour ASC
`;

async function queryBridgeBuckets(pool, { from, to }) {
  const { rows } = await pool.query(QUERY_BUCKETS, [from, to]);
  return rows;
}

module.exports = { upsertBridgeBuckets, queryBridgeBuckets };
```

- [ ] **Step 4.2: Run the integration test to verify it passes**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/server && PGPORT=5434 npx jest tests/integration/bridgeBuckets.test.js --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS

- [ ] **Step 4.3: Commit**

```bash
git add server/schema.sql server/src/db/bridgeBuckets.js server/tests/integration/bridgeBuckets.test.js
git commit -m "feat: bridge_hourly_buckets schema and DB layer"
```

---

## Task 5: Update ledgerProcessor.js

Remove Redis bridge log writes. Add in-memory accumulator and ledger-close flush to Postgres.

**Files:**
- Modify: `server/src/ingest/ledgerProcessor.js`

- [ ] **Step 5.1: Replace imports at the top of ledgerProcessor.js**

Remove this line:
```js
const { recordBridgeEvent, trimBridgeEvents } = require('../redis/bridgeTimeseries');
```

Add this line in its place:
```js
const { upsertBridgeBuckets } = require('../db/bridgeBuckets');
```

- [ ] **Step 5.2: Add `truncateToHour` helper before `createLedgerProcessor`**

Add after the existing `initAccumulator` function (before `createLedgerProcessor`):

```js
function truncateToHour(ledgerTime) {
  const d = ledgerTime instanceof Date ? new Date(ledgerTime) : new Date(ledgerTime);
  d.setUTCMinutes(0, 0, 0);
  return d;
}
```

- [ ] **Step 5.3: Add `bridgeAcc` Map alongside `acc` inside `createLedgerProcessor`**

In `createLedgerProcessor`, change:
```js
  let acc              = initAccumulator();
```
to:
```js
  let acc              = initAccumulator();
  let bridgeAcc        = new Map();
```

- [ ] **Step 5.4: Replace the bridge detection block in `handleTransaction`**

Find and replace:
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

With:
```js
    try {
      const bridges = detectBridges(fills);
      for (const b of bridges) {
        publishBridge(redis, b).catch((err) => {
          console.error('[BRIDGE] Failed to publish bridge event:', err.message);
        });
        const hour       = truncateToHour(b.ledgerTime);
        const fromIssuer = b.fromIssuer ?? '';
        const toIssuer   = b.toIssuer   ?? '';
        const key        = `${hour.toISOString()}:${b.fromCurrency}:${fromIssuer}:${b.toCurrency}:${toIssuer}`;
        const entry      = bridgeAcc.get(key) ?? {
          hour, fromCurrency: b.fromCurrency, fromIssuer,
          toCurrency: b.toCurrency, toIssuer,
          fromVolume: 0, toVolume: 0, xrpVolume: 0, eventCount: 0,
        };
        entry.fromVolume  += Number(b.fromValue);
        entry.toVolume    += Number(b.toValue);
        entry.xrpVolume   += Number(b.xrpValue);
        entry.eventCount  += 1;
        bridgeAcc.set(key, entry);
      }
    } catch (err) {
      console.error('[BRIDGE] Detection error:', err.message);
    }
```

- [ ] **Step 5.5: Add bridge flush to `handleLedgerClosed` and remove `trimBridgeEvents`**

Find:
```js
    trimBridgeEvents(redis).catch((err) => {
      console.error('[BRIDGE] Failed to trim events:', err.message);
    });
```

Replace with:
```js
    if (bridgeAcc.size > 0) {
      const rows = [...bridgeAcc.values()];
      bridgeAcc.clear();
      upsertBridgeBuckets(pool, rows).catch((err) => {
        console.error('[BRIDGE] Failed to upsert bridge buckets:', err.message);
      });
    }
```

- [ ] **Step 5.6: Run existing unit tests to confirm nothing is broken**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/server && npm test 2>&1 | tail -20
```

Expected: all unit tests PASS

- [ ] **Step 5.7: Commit**

```bash
git add server/src/ingest/ledgerProcessor.js
git commit -m "feat: accumulate bridge events per ledger, flush to Postgres on close"
```

---

## Task 6: Simplify bridgeTimeseries.js + Delete Stale Integration Test

**Files:**
- Modify: `server/src/redis/bridgeTimeseries.js`
- Delete: `server/tests/integration/bridgeTimeseries.test.js`

- [ ] **Step 6.1: Rewrite bridgeTimeseries.js to export only constants**

Replace the entire contents of `server/src/redis/bridgeTimeseries.js` with:

```js
// ms epoch timestamps, not seconds
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

module.exports = { WINDOWS, BUCKET_MS };
```

- [ ] **Step 6.2: Delete the stale integration test (stages the deletion)**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor && git rm server/tests/integration/bridgeTimeseries.test.js
```

Expected: `rm 'server/tests/integration/bridgeTimeseries.test.js'`

- [ ] **Step 6.3: Run all server tests**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/server && npm test 2>&1 | tail -20
```

Expected: all unit tests PASS (unit/bridgeTimeseries.test.js still passes — it only tests `WINDOWS` and `BUCKET_MS`)

- [ ] **Step 6.4: Commit**

```bash
git add server/src/redis/bridgeTimeseries.js
git commit -m "refactor: strip Redis bridge log from bridgeTimeseries, delete stale test"
```

---

## Task 7: Update Bridge API + app.js

Replace `GET /bridge/events` (Redis) with `GET /bridge/buckets` (Postgres). The router factory now needs `pool` instead of `redis`.

**Files:**
- Modify: `server/src/api/bridge.js`
- Modify: `server/src/api/app.js`

- [ ] **Step 7.1: Rewrite bridge.js**

Replace the entire contents of `server/src/api/bridge.js` with:

```js
const { Router } = require('express');
const { queryBridgeBuckets } = require('../db/bridgeBuckets');

function createBridgeRouter({ pool }) {
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
      const buckets = await queryBridgeBuckets(pool, { from: fromDate, to: toDate });
      res.json({ from, to, buckets });
    } catch (err) {
      console.error('[BRIDGE/BUCKETS] Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createBridgeRouter };
```

- [ ] **Step 7.2: Update app.js to pass pool to createBridgeRouter**

In `server/src/api/app.js`, find:
```js
  app.use('/bridge', createBridgeRouter({ redis }));
```

Replace with:
```js
  app.use('/bridge', createBridgeRouter({ pool }));
```

- [ ] **Step 7.3: Run unit tests**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/server && npm test 2>&1 | tail -20
```

Expected: all unit tests PASS

- [ ] **Step 7.4: Commit**

```bash
git add server/src/api/bridge.js server/src/api/app.js
git commit -m "feat: replace /bridge/events (Redis) with /bridge/buckets (Postgres)"
```

---

## Task 8: Write Failing Client Tests for aggregateBridgeBuckets

**Files:**
- Modify: `client/src/hooks/useBridgeHistory.test.js`

- [ ] **Step 8.1: Replace the test file with updated tests for `aggregateBridgeBuckets`**

Replace the entire contents of `client/src/hooks/useBridgeHistory.test.js` with:

```js
import { describe, it, expect } from 'vitest';
import { aggregateBridgeBuckets, BUCKET_MS, WINDOWS_MS } from './useBridgeHistory';

function makeBucket(overrides = {}) {
  return {
    hour:         new Date().toISOString(),
    fromCurrency: 'USD',
    fromIssuer:   'rIssuer1',
    toCurrency:   'EUR',
    toIssuer:     'rIssuer2',
    fromVolume:   '50',
    toVolume:     '46',
    xrpVolume:    '100',
    eventCount:   1,
    ...overrides,
  };
}

describe('aggregateBridgeBuckets', () => {
  const now = Date.now();

  it('builds summary with fromVolume and toVolume per currency using xrpVolume', () => {
    const buckets = [makeBucket({ hour: new Date(now - 60_000).toISOString() })];
    const { summary } = aggregateBridgeBuckets(buckets, '1h', now);
    expect(summary['USD'].fromVolume).toBeCloseTo(100);
    expect(summary['USD'].toVolume).toBe(0);
    expect(summary['EUR'].toVolume).toBeCloseTo(100);
    expect(summary['EUR'].fromVolume).toBe(0);
    expect(summary['USD'].count).toBe(1);
    expect(summary['EUR'].count).toBe(1);
  });

  it('accumulates multiple buckets for the same currency', () => {
    const buckets = [
      makeBucket({ hour: new Date(now - 60 * 60_000).toISOString(), xrpVolume: '100' }),
      makeBucket({ hour: new Date(now - 30 * 60_000).toISOString(), xrpVolume: '50'  }),
    ];
    const { summary } = aggregateBridgeBuckets(buckets, '24h', now);
    expect(summary['USD'].fromVolume).toBeCloseTo(150);
    expect(summary['USD'].count).toBe(2);
  });

  it('returns topCurrencies sorted by total volume descending, max 5', () => {
    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'];
    const buckets = currencies.map((fc, i) =>
      makeBucket({
        hour: new Date(now - 60_000).toISOString(),
        fromCurrency: fc, toCurrency: 'XAH',
        fromIssuer: '', toIssuer: '',
        xrpVolume: String((6 - i) * 10),
        eventCount: 1,
      })
    );
    const { topCurrencies } = aggregateBridgeBuckets(buckets, '24h', now);
    expect(topCurrencies).toHaveLength(5);
    expect(topCurrencies[0]).toBe('XAH');
    expect(topCurrencies).toContain('USD');
    expect(topCurrencies).toContain('EUR');
  });

  it('returns correct number of chart buckets for each window', () => {
    const b = makeBucket({ hour: new Date(now - 60_000).toISOString() });
    expect(aggregateBridgeBuckets([b], '10m', now).series).toHaveLength(20);
    expect(aggregateBridgeBuckets([b], '1h',  now).series).toHaveLength(12);
    expect(aggregateBridgeBuckets([b], '24h', now).series).toHaveLength(24);
  });

  it('places bucket volume in the correct chart slot', () => {
    const bucketMs  = BUCKET_MS['24h']; // 1h
    const windowMs  = WINDOWS_MS['24h'];
    const windowStart = now - windowMs;
    const ts = now - 3 * 60 * 60_000; // 3 hours ago
    const expectedIdx = Math.floor((ts - windowStart) / bucketMs);
    const b = makeBucket({ hour: new Date(ts).toISOString(), xrpVolume: '200' });
    const { series } = aggregateBridgeBuckets([b], '24h', now);
    const total = Object.values(series[expectedIdx].currencies).reduce((a, v) => a + v, 0);
    expect(total).toBeCloseTo(200);
  });

  it('groups currencies beyond top 5 into "other"', () => {
    const currencies = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const buckets = currencies.map((fc, i) =>
      makeBucket({
        hour: new Date(now - 60_000).toISOString(),
        fromCurrency: fc, toCurrency: 'Z',
        fromIssuer: '', toIssuer: '',
        xrpVolume: '10', eventCount: 1,
      })
    );
    const { series, topCurrencies } = aggregateBridgeBuckets(buckets, '24h', now);
    expect(topCurrencies).toHaveLength(5);
    const anyBucketHasOther = series.some((b) => b.currencies['other'] > 0);
    expect(anyBucketHasOther).toBe(true);
  });

  it('throws for unknown timeWindow', () => {
    expect(() => aggregateBridgeBuckets([], '7d')).toThrow('Unknown timeWindow');
  });
});
```

- [ ] **Step 8.2: Run the client tests to confirm they fail**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/client && npx vitest run src/hooks/useBridgeHistory.test.js 2>&1 | tail -20
```

Expected: FAIL — `aggregateBridgeBuckets is not a function` (or not exported)

---

## Task 9: Update Client Hook, http.js, and Tests

**Files:**
- Modify: `client/src/api/http.js`
- Modify: `client/src/hooks/useBridgeHistory.js`

- [ ] **Step 9.1: Replace `fetchBridgeEvents` with `fetchBridgeBuckets` in http.js**

In `client/src/api/http.js`, find:
```js
export function fetchBridgeEvents(timeWindow) {
  return api.get('/bridge/events', { params: { window: timeWindow } }).then((r) => r.data);
}
```

Replace with:
```js
export function fetchBridgeBuckets(from, to) {
  return api.get('/bridge/buckets', { params: { from, to } }).then((r) => r.data);
}
```

- [ ] **Step 9.2: Rewrite useBridgeHistory.js**

Replace the entire contents of `client/src/hooks/useBridgeHistory.js` with:

```js
import { useQuery } from '@tanstack/react-query';
import { fetchBridgeBuckets } from '../api/http';

export const BUCKET_MS  = { '10m': 30_000,         '1h': 5 * 60_000,        '24h': 60 * 60_000 };
export const WINDOWS_MS = { '10m': 10 * 60_000,    '1h': 60 * 60_000,       '24h': 24 * 60 * 60_000 };
const TOP_N = 5;

export function aggregateBridgeBuckets(buckets, timeWindow, now = Date.now()) {
  if (!BUCKET_MS[timeWindow] || !WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
  const bucketMs    = BUCKET_MS[timeWindow];
  const windowMs    = WINDOWS_MS[timeWindow];
  const windowStart = now - windowMs;
  const numBuckets  = Math.ceil(windowMs / bucketMs);

  const summary        = {};
  const currencyTotals = {};

  for (const b of buckets) {
    const xrp = parseFloat(b.xrpVolume) || 0;
    const { fromCurrency: fc, toCurrency: tc, eventCount } = b;
    summary[fc] = { fromVolume: (summary[fc]?.fromVolume ?? 0) + xrp, toVolume: summary[fc]?.toVolume ?? 0,  count: (summary[fc]?.count ?? 0) + eventCount };
    summary[tc] = { fromVolume: summary[tc]?.fromVolume ?? 0,          toVolume: (summary[tc]?.toVolume ?? 0) + xrp, count: (summary[tc]?.count ?? 0) + eventCount };
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

  for (const b of buckets) {
    const ts  = new Date(b.hour).getTime();
    const xrp = parseFloat(b.xrpVolume) || 0;
    for (const c of [b.fromCurrency, b.toCurrency]) {
      const idx = Math.floor((ts - windowStart) / bucketMs);
      if (idx < 0 || idx >= numBuckets) continue;
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
      if (!WINDOWS_MS[timeWindow]) throw new Error(`Unknown timeWindow: ${timeWindow}`);
      const to   = new Date().toISOString();
      const from = new Date(Date.now() - WINDOWS_MS[timeWindow]).toISOString();
      const { buckets } = await fetchBridgeBuckets(from, to);
      const { summary, series, topCurrencies } = aggregateBridgeBuckets(buckets, timeWindow);
      return { summary, series, topCurrencies };
    },
    refetchInterval: 30_000,
    staleTime:       15_000,
    enabled:         !!timeWindow,
  });
}
```

- [ ] **Step 9.3: Run the client tests — they should now pass**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/client && npx vitest run src/hooks/useBridgeHistory.test.js 2>&1 | tail -20
```

Expected: all tests PASS

- [ ] **Step 9.4: Commit**

```bash
git add client/src/api/http.js client/src/hooks/useBridgeHistory.js client/src/hooks/useBridgeHistory.test.js
git commit -m "feat: client reads bridge history from Postgres buckets endpoint"
```

---

## Task 10: Update BridgeView — Remove Replay, Wire New Data Shape

`historyData` no longer has an `events` array — only `summary`, `series`, `topCurrencies`. Remove the replay controls and all code that depended on `historyData.events`.

**Files:**
- Modify: `client/src/components/BridgeView.jsx`

- [ ] **Step 10.1: Remove replay state, refs, and functions**

In `BridgeView`, remove the following lines:

```js
  const [playing, setPlaying]     = useState(false);
  const [speed,   setSpeed]       = useState(10);   // multiplier: 1 | 10 | 50
  const replayRef                 = useRef(null);
  const replayIdxRef              = useRef(0);
  const replayEventsRef           = useRef([]);
```

Remove the `stopReplay` function:
```js
  function stopReplay() {
    clearInterval(replayRef.current);
    replayRef.current = null;
    setPlaying(false);
  }
```

Remove the `startReplay` function:
```js
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
```

Remove the `seekReplay` and `handleSparklineSeek` functions:
```js
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
```

Remove the replay cleanup effect:
```js
  useEffect(() => () => clearInterval(replayRef.current), []);
```

- [ ] **Step 10.2: Update the window toggle to not call stopReplay**

Find:
```js
        onChange={(_, v) => {
          if (v) {
            stopReplay();
            setViewWindow(v);
            setRingCurrencies([]);
            setQueue([]);
          }
        }}
```

Replace with:
```js
        onChange={(_, v) => {
          if (v) {
            setViewWindow(v);
            setRingCurrencies([]);
            setQueue([]);
          }
        }}
```

- [ ] **Step 10.3: Remove the replay controls JSX block**

Find and remove the entire replay controls box (the `{!isLive && ( <Box ...> ... </Box> )}` block that contains the Play/Pause button and speed ToggleButtonGroup):

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
```

- [ ] **Step 10.4: Remove `onSeek` from the sparkline (no longer needed)**

Find:
```jsx
          <BridgeSparkline
            series={historyData.series}
            topCurrencies={historyData.topCurrencies}
            ringCurrencies={ringCurrencies}
            onSeek={handleSparklineSeek}
          />
```

Replace with:
```jsx
          <BridgeSparkline
            series={historyData.series}
            topCurrencies={historyData.topCurrencies}
            ringCurrencies={ringCurrencies}
          />
```

- [ ] **Step 10.5: Remove unused `useRef` import (if no refs remain)**

Check the remaining `useRef` usage in BridgeView: `svgRef` is still used. Keep `useRef` in the import. No change needed.

- [ ] **Step 10.6: Run the full client test suite**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/client && npx vitest run 2>&1 | tail -20
```

Expected: all tests PASS

- [ ] **Step 10.7: Commit**

```bash
git add client/src/components/BridgeView.jsx
git commit -m "refactor: remove replay controls from historical mode (no longer have raw events)"
```

---

## Task 11: Final Verification + Push

- [ ] **Step 11.1: Run all server tests**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/server && npm test 2>&1 | tail -20
```

Expected: all unit tests PASS

- [ ] **Step 11.2: Run all client tests**

```bash
cd /Users/naoryuval/Dev/xrpl-monitor/client && npx vitest run 2>&1 | tail -20
```

Expected: all tests PASS

- [ ] **Step 11.3: Verify git log on the branch**

```bash
git log --oneline feat/bridge-hourly-buckets ^main
```

Expected output (6 commits):
```
<hash> refactor: remove replay controls from historical mode (no longer have raw events)
<hash> feat: client reads bridge history from Postgres buckets endpoint
<hash> feat: replace /bridge/events (Redis) with /bridge/buckets (Postgres)
<hash> refactor: strip Redis bridge log from bridgeTimeseries, delete stale test
<hash> feat: accumulate bridge events per ledger, flush to Postgres on close
<hash> feat: bridge_hourly_buckets schema and DB layer
```

- [ ] **Step 11.4: Push the branch**

```bash
git push -u origin feat/bridge-hourly-buckets
```
