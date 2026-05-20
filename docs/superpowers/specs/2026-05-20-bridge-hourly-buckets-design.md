# Bridge Hourly Buckets — Design Spec

**Date:** 2026-05-20
**Status:** Approved

## Problem

Bridge events are stored only in Redis (`bridge:log` sorted set, trimmed to 24h max). A server restart or Redis flush loses all accumulated data. The goal is durable, permanent storage of XRP autobridging timeseries data at hourly bucket resolution.

## Decision Summary

- **Storage shape:** Pre-aggregated hourly buckets (not raw events)
- **Dimensions:** `(from_currency, from_issuer, to_currency, to_issuer, hour)`
- **Write strategy:** Batch upsert on ledger close (Option B) — consistent with the existing ledger-close-as-boundary design principle
- **Feature branch:** All changes on a dedicated branch, not directly on `main`

---

## Schema

New table added to `schema.sql` and applied via migration:

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

- XRP issuers stored as `''` (empty string, not NULL) so the composite PK is safe.
- `hour` is always `DATE_TRUNC('hour', ledger_time)`.

---

## Ingest Layer

### New file: `server/src/db/bridgeBuckets.js`

Two exported functions:

**`upsertBridgeBuckets(pool, rows)`**
- Accepts an array of `{ hour, fromCurrency, fromIssuer, toCurrency, toIssuer, fromVolume, toVolume, xrpVolume, eventCount }`
- Issues a single multi-row `INSERT ... ON CONFLICT (hour, from_currency, from_issuer, to_currency, to_issuer) DO UPDATE SET from_volume = from_volume + EXCLUDED.from_volume, ...`
- Safe under concurrent writes

**`queryBridgeBuckets(pool, { from, to })`**
- `SELECT ... WHERE hour >= from AND hour < to ORDER BY hour ASC`

### Changes to `server/src/ingest/ledgerProcessor.js`

**Accumulator** — add `bridgeAcc = new Map()` alongside the existing `acc`. Keyed by `${hour}:${fromCurrency}:${fromIssuer}:${toCurrency}:${toIssuer}`. In `handleTransaction`, after `detectBridges`, sum each bridge event into its map entry:

```js
const hour = truncateToHour(b.ledgerTime);
const key  = `${hour}:${b.fromCurrency}:${b.fromIssuer ?? ''}:${b.toCurrency}:${b.toIssuer ?? ''}`;
const entry = bridgeAcc.get(key) ?? { hour, ...dims, fromVolume: 0, toVolume: 0, xrpVolume: 0, eventCount: 0 };
entry.fromVolume += Number(b.fromValue);
entry.toVolume   += Number(b.toValue);
entry.xrpVolume  += Number(b.xrpValue);
entry.eventCount += 1;
bridgeAcc.set(key, entry);
```

**Flush on ledger close** — at the end of `handleLedgerClose`:
```js
if (bridgeAcc.size > 0) {
  await upsertBridgeBuckets(pool, [...bridgeAcc.values()]);
  bridgeAcc.clear();
}
```

### Remove Redis bridge log

- Remove `recordBridgeEvent` call from `ledgerProcessor.js` — Postgres is now the durable store.
- Remove `trimBridgeEvents` call from the ledger-close handler.
- Keep `publishBridge` (Redis Pub/Sub) — still needed for real-time client push.
- `bridgeTimeseries.js` can be simplified: remove `recordBridgeEvent`, `trimBridgeEvents`, `LOG_KEY`; retain `WINDOWS` and `BUCKET_MS` constants if still used by the client hook.

---

## API

### New route: `GET /bridge/buckets`

Added to the existing bridge router in `server/src/api/bridge.js`.

**Query params:**
- `from` — ISO 8601 timestamp (required)
- `to` — ISO 8601 timestamp (required)

**Validation:** both present and parseable; `from < to`; returns 400 otherwise.

**Response:**
```json
{
  "from": "2026-05-19T00:00:00Z",
  "to":   "2026-05-20T00:00:00Z",
  "buckets": [
    {
      "hour": "2026-05-19T14:00:00Z",
      "fromCurrency": "ETH", "fromIssuer": "",
      "toCurrency": "USD",  "toIssuer": "rvYAfW...",
      "fromVolume": "142.5", "toVolume": "310.2",
      "xrpVolume": "4820.0", "eventCount": 37
    }
  ]
}
```

---

## Client

### `useBridgeHistory.js`

Replace the call to `GET /bridge/events?window=X` with `GET /bridge/buckets?from=ISO&to=ISO`:
- Compute `from = new Date(Date.now() - windowMs).toISOString()` and `to = new Date().toISOString()`
- Response shape changes from raw events to pre-aggregated buckets; update the client-side reducer accordingly (sum `fromVolume`, `toVolume`, `xrpVolume`, `eventCount` per currency across all buckets in the response)

### `BridgeView.jsx`

No structural changes expected — `activeStats` shape (per-currency `{ fromVolume, toVolume, count }`) stays the same; only the source of truth shifts from Redis events to Postgres buckets.

---

## Files Changed

| File | Change |
|---|---|
| `server/schema.sql` | Add `bridge_hourly_buckets` table + index |
| `server/src/db/bridgeBuckets.js` | New — `upsertBridgeBuckets`, `queryBridgeBuckets` |
| `server/src/ingest/ledgerProcessor.js` | Add `bridgeAcc`, flush on ledger close, remove Redis log calls |
| `server/src/redis/bridgeTimeseries.js` | Remove `recordBridgeEvent`, `trimBridgeEvents`, `LOG_KEY` |
| `server/src/api/bridge.js` | Add `GET /bridge/buckets` route |
| `client/src/hooks/useBridgeHistory.js` | Point to new endpoint, update reducer |

---

## What Is NOT Changed

- `publishBridge` (Redis Pub/Sub) — real-time push stays as-is
- `BridgeView.jsx` ring chart, replay controls, sparkline — no structural changes
- `GET /bridge/events` — remove once `useBridgeHistory` no longer calls it (the underlying Redis log will stop being written to, making the endpoint a dead stub)
