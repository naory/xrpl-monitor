# Escrow Timeseries — Design Spec

## Goal

Track XRPL escrow activity (`EscrowCreate`, `EscrowFinish`, `EscrowCancel`) as hourly Postgres buckets, expose it via REST and WebSocket, and display it in two new top-level tabs: **ESCROW TIME** (time-locked vesting/OTC) and **ESCROW ILP** (crypto-condition / HTLC / ILP-style).

---

## Background

Escrows on XRPL come in two distinct flavors:

- **Time-lock escrows** — only a `FinishAfter`/`CancelAfter` time field; used for vesting schedules, OTC deals, scheduled payments. Finish typically takes hours to days.
- **ILP/HTLC escrows** — include a `Condition` field (PREIMAGE-SHA-256 crypto-condition); the `EscrowFinish` must supply the matching `Fulfillment`. Finish typically takes seconds to a few minutes, signaling ILP-style usage.

Both tabs share the same layout (KPI cards + stacked timeseries + TTF histogram + live feed) and the same ingest pipeline. Classification happens at `EscrowCreate` time.

---

## Classification Rule

At `EscrowCreate`:
- `tx_json.Condition` present → `type = 'ilp'`
- No `Condition` → `type = 'time_lock'`

At `EscrowFinish`/`EscrowCancel` (when create is not in Redis):
- `tx_json.Fulfillment` present → `type = 'ilp'`
- Otherwise → `type = 'time_lock'`

Escrows with both a condition AND time fields are classified as `'ilp'` (condition takes precedence).

---

## Architecture

### TTF (Time-to-Finish) Tracking via Redis

On every `EscrowCreate`, store:
```
KEY  escrow:ttf:{account}:{sequence}
VAL  {"type":"ilp","amountDrops":500000000,"createdAtMs":1716285600000}
TTL  604800 (7 days)
```

On `EscrowFinish`/`EscrowCancel`:
1. Look up `escrow:ttf:{owner}:{offerSequence}`
2. If found: compute `ttfMs = finishLedgerTimeMs - createdAtMs`, read `type` and `amountDrops`, delete key
3. If not found (server restarted mid-lifecycle): classify by fallback rule above; `amountDrops` is 0 (amount unknown without the original create)

TTF is bucketed into six columns in the hourly table (see schema).

---

## Server

### Schema

```sql
CREATE TABLE IF NOT EXISTS escrow_hourly (
    hour          TIMESTAMP NOT NULL,
    type          VARCHAR(16) NOT NULL,
    creates       INTEGER NOT NULL DEFAULT 0,
    finishes      INTEGER NOT NULL DEFAULT 0,
    cancels       INTEGER NOT NULL DEFAULT 0,
    xrp_created   NUMERIC(38,18) NOT NULL DEFAULT 0,
    xrp_finished  NUMERIC(38,18) NOT NULL DEFAULT 0,
    xrp_cancelled NUMERIC(38,18) NOT NULL DEFAULT 0,
    ttf_lt_5s     INTEGER NOT NULL DEFAULT 0,
    ttf_lt_30s    INTEGER NOT NULL DEFAULT 0,
    ttf_lt_5m     INTEGER NOT NULL DEFAULT 0,
    ttf_lt_1h     INTEGER NOT NULL DEFAULT 0,
    ttf_lt_1d     INTEGER NOT NULL DEFAULT 0,
    ttf_gte_1d    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, type)
);
CREATE INDEX IF NOT EXISTS idx_escrow_hourly_hour ON escrow_hourly (hour);
```

`type` is `'time_lock'` or `'ilp'`. TTF bucket columns span seconds to days — ILP data clusters in the first three, time-lock in the last two.

### New Files

| File | Responsibility |
|------|----------------|
| `server/src/ingest/escrowExtractor.js` | `extractEscrows(event)` — returns normalized escrow event objects for all three tx types |
| `server/src/db/escrowBuckets.js` | `upsertEscrowBuckets(pool, rows)` — upsert-accumulate pattern; `queryEscrowBuckets(pool, { from, to, type })` |
| `server/src/api/escrow.js` | Express router — `GET /escrow/time-lock/buckets` and `GET /escrow/ilp/buckets`; 48h max range validation |

### Modified Files

| File | Change |
|------|--------|
| `server/schema.sql` | Add `escrow_hourly` table + index |
| `server/src/ingest/ledgerProcessor.js` | Import `extractEscrows`; add `escrowAcc` Map; Redis TTF store/lookup/delete; accumulate hourly buckets; flush on ledger close via `upsertEscrowBuckets`; publish live events |
| `server/src/redis/publisher.js` | Add `CHANNELS.ESCROW = 'xrpl:escrow'`; `buildEscrowMessage(event)`; `publishEscrow(redis, event)` |
| `server/src/api/app.js` | Mount `createEscrowRouter` at `/escrow` |
| `server/src/api/ws.js` | Add `CHANNELS.ESCROW` to `SUBSCRIBED_CHANNELS` |

### escrowExtractor.js — Output Shapes

**EscrowCreate:**
```js
{
  txType: 'EscrowCreate',
  txHash, ledgerIndex, ledgerTime,
  type,           // 'ilp' | 'time_lock'
  account,        // creator
  sequence,       // tx sequence (used as escrow ID with account)
  destination,
  amountDrops,    // integer drops
  finishAfter,    // ripple epoch seconds or null
  cancelAfter,    // ripple epoch seconds or null
  hasCondition,   // boolean
}
```

**EscrowFinish / EscrowCancel:**
```js
{
  txType: 'EscrowFinish' | 'EscrowCancel',
  txHash, ledgerIndex, ledgerTime,
  owner,          // original creator account
  offerSequence,  // sequence of the EscrowCreate tx
  hasFulfillment, // boolean (EscrowFinish only)
}
```

### Accumulator Row Shape (flushed to DB)

```js
{
  hour,           // Date truncated to hour
  type,           // 'ilp' | 'time_lock'
  creates, finishes, cancels,
  xrpCreated, xrpFinished, xrpCancelled,  // in XRP (not drops)
  ttfLt5s, ttfLt30s, ttfLt5m, ttfLt1h, ttfLt1d, ttfGte1d,
}
```

### Live WebSocket Event

Published during `handleTransaction` per escrow event:

```json
{
  "type": "escrow",
  "data": {
    "txType": "EscrowFinish",
    "escrowType": "ilp",
    "txHash": "A1B2C3...",
    "ledgerIndex": 91234567,
    "amountXrp": "500.000000",
    "ttfMs": 4100,
    "owner": "rAcc...",
    "destination": "rDst..."
  }
}
```

`ttfMs` is omitted for `EscrowCreate` and when TTF is not available (fallback classification).

### REST Response

```json
{
  "from": "2026-05-21T00:00:00.000Z",
  "to":   "2026-05-21T01:00:00.000Z",
  "buckets": [
    {
      "hour": "2026-05-21T00:00:00.000Z",
      "type": "ilp",
      "creates": 12,
      "finishes": 10,
      "cancels": 1,
      "xrpCreated": "6000.0",
      "xrpFinished": "5000.0",
      "xrpCancelled": "500.0",
      "ttfLt5s": 7,
      "ttfLt30s": 2,
      "ttfLt5m": 1,
      "ttfLt1h": 0,
      "ttfLt1d": 0,
      "ttfGte1d": 0
    }
  ]
}
```

---

## Client

### New Files

| File | Responsibility |
|------|----------------|
| `client/src/hooks/useEscrowHistory.js` | `useEscrowHistory(type, timeWindow)` — fetches `/escrow/{type}/buckets`, runs `aggregateEscrowBuckets`; exports pure aggregator for unit tests |
| `client/src/hooks/useEscrowHistory.test.js` | Unit tests for `aggregateEscrowBuckets` — success rate, TTF bucketing, series placement, unknown window throw |
| `client/src/hooks/useEscrowStream.js` | `useEscrowStream(type)` — filters live `escrowEvents` by `escrowType`, deduplicates by `txHash`, returns `{ recentEvents, stats }` |
| `client/src/components/EscrowView.jsx` | Single component, `type` prop (`'time_lock'` or `'ilp'`) — full layout C rendering |

### Modified Files

| File | Change |
|------|--------|
| `client/src/store/useWsStore.js` | Add `escrowEvents: []`; `addEscrowEvent(event)` — prepend, slice to 200 |
| `client/src/api/socket.js` | Route `msg.type === 'escrow'` → `store.addEscrowEvent(msg.data)` |
| `client/src/api/http.js` | Add `fetchEscrowBuckets(type, from, to)` |
| `client/src/components/Dashboard.jsx` | Add `mode === 'escrow-time'` and `mode === 'escrow-ilp'` branches |
| `client/src/App.jsx` | Add `'escrow-time'` and `'escrow-ilp'` to `MODES`; add `MODE_LABELS` entries `'ESCROW TIME'` and `'ESCROW ILP'` |
| `client/vite.config.js` | Add `/escrow` proxy entry |

### `aggregateEscrowBuckets(buckets, timeWindow, now)` Returns

```js
{
  summary: {
    creates, finishes, cancels,
    xrpCreated, xrpFinished, xrpCancelled,
    successRate,   // finishes / (finishes + cancels), null if 0
    ttfBuckets: { lt5s, lt30s, lt5m, lt1h, lt1d, gte1d },
    medianTtfLabel, // e.g. "4.2s" or "3.2d" derived from histogram
  },
  series: [{ ts, finishes, cancels }],  // for stacked bar chart
  topCurrencies: [],                     // reserved for future IOU split
}
```

`medianTtfLabel` is derived by finding the TTF bucket that contains the 50th percentile finish (cumulative count crosses `totalFinishes / 2`) and returning a human-readable midpoint label. Bucket midpoints: `lt5s→"2.5s"`, `lt30s→"17s"`, `lt5m→"2.5m"`, `lt1h→"32m"`, `lt1d→"12.5h"`, `gte1d→">1d"`. Returns `"—"` when `finishes === 0`.

### EscrowView Layout (Layout C)

```
┌──────────┬──────────┬──────────┬──────────┐
│  Success │  Median  │  Total   │  Volume  │
│   Rate   │   TTF    │  Count   │   XRP    │
└──────────┴──────────┴──────────┴──────────┘
┌──────────────────────────────────────────┐
│  Finish / Cancel stacked bar (over time) │
│  [window selector: live | 10m | 1h | 24h]│
└──────────────────────────────────────────┘
┌────────────────────┬─────────────────────┐
│  TTF Histogram     │  Live Event Feed    │
│  <5s·<30s·<5m·     │  FINISH 500XRP 4.1s │
│  <1h·<1d·≥1d       │  CANCEL 2000XRP     │
└────────────────────┴─────────────────────┘
```

- **Success Rate** — `finishes / (finishes + cancels)` — green text; `—` when no settled escrows
- **Median TTF** — human-readable from histogram midpoints (e.g. `4.2s`, `3.2d`); `—` when no finishes
- **Stacked bar chart** — green = finishes, red = cancels; hourly buckets; window selector triggers history refetch
- **TTF histogram** — fixed 6 buckets, bars colored green→yellow→red left to right; ILP peaks left, time-lock peaks right; labeled `<5s · <30s · <5m · <1h · <1d · ≥1d`
- **Live event feed** — most recent 20 events; `FINISH` in green with TTF if available, `CANCEL` in red, `CREATE` in muted; shows amount in XRP and truncated addresses

In `live` mode: KPIs and feed come from `useEscrowStream`; stacked chart and TTF histogram hidden (insufficient data without historical context). In historical modes: all four sections populated from `useEscrowHistory`.

---

## Testing

- **Unit:** `aggregateEscrowBuckets` — success rate calculation, TTF bucket placement, `medianTtfLabel` derivation, series shape, unknown timeWindow throw
- **Integration:** `escrowBuckets.test.js` — upsert accumulation, query by type and time range (same `test.skip` pattern as `bridgeBuckets.test.js`)
- **Manual:** start app, verify ESCROW TIME and ESCROW ILP tabs appear; confirm live feed populates as escrow transactions arrive

---

## Non-Goals

- Per-issuer IOU escrow breakdown (future — add `currency` column to `escrow_hourly`)
- Tracking "open" escrow count or total locked XRP at a point in time (requires persistent lifecycle table, not hourly aggregation)
- Historical backfill of escrows before first boot
