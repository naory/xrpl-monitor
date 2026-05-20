# XRP Direct Demand Timeseries — Design Spec

## Goal

Track direct XRP/IOU trading activity (excluding autobridging) as hourly Postgres buckets, expose it via REST and WebSocket, and display it alongside the existing BridgeView in a unified "XRP FLOW" tab.

## Background

The existing `bridge` tab shows XRP's role as an *intermediate* (autobridging: IOU_A → XRP → IOU_B). This feature adds the complementary view: trades where XRP is the *actual* traded asset — e.g., someone buys XRP with USD or sells XRP for EUR.

Both views use the same ring-visualization pattern and live + historical data model.

---

## Architecture

### Detection Rule

Per transaction, within `ledgerProcessor.js`:

1. `fills = extractFills(event)`
2. `bridges = detectBridges(fills)`
3. **If bridges detected** → those fills' XRP legs are autobridging intermediates; skip them for demand accounting.
4. **Otherwise** → for each fill where one side is XRP:
   - `getsCurrency === 'XRP'` → XRP bought: `xrpBought += getsValue`, `currency = paysCurrency`
   - `paysCurrency === 'XRP'` → XRP sold: `xrpSold += paysValue`, `currency = getsCurrency`
5. Accumulate into `xrpDemandAcc` Map keyed by `${hour.toISOString()}:${currency}` (currency only — all issuers collapsed). Flush on ledger close, same as `bridgeAcc`.
6. After accumulation, publish a live `xrp-demand` event immediately (during `handleTransaction`, not on ledger close) — same timing as bridge event publishing — so the client ring animates in real time.

**Issuer collapsing:** All USD issuers (Bitstamp, Gatehub, etc.) fold into a single `currency = 'USD'` bucket. This matches the user-requested aggregation ("aggregate all USD IOUs").

---

## Server

### Schema — new table

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

### New files

| File | Responsibility |
|------|---------------|
| `server/src/db/xrpDemandBuckets.js` | `upsertXrpDemandBuckets(pool, rows)` and `queryXrpDemandBuckets(pool, { from, to })` — same upsert-accumulate pattern as `bridgeBuckets.js` |
| `server/src/api/xrpDemand.js` | Express router, `GET /xrp-demand/buckets?from=ISO&to=ISO` — same validation pattern as `bridge.js` |

### Modified files

| File | Change |
|------|--------|
| `server/schema.sql` | Add `xrp_demand_hourly` table + index |
| `server/src/ingest/ledgerProcessor.js` | Add `xrpDemandAcc` Map; detection + accumulation logic; flush on ledger close via `upsertXrpDemandBuckets`; publish live events via `publishXrpDemand` |
| `server/src/redis/publisher.js` | Add `publishXrpDemand(redis, event)` — publishes to a new `xrpl:xrp-demand` Redis pub/sub channel |
| `server/src/api/app.js` | Mount `xrpDemandRouter` at `/xrp-demand` |
| `server/src/api/ws.js` | Route `xrp-demand` events to WebSocket clients |

### WebSocket event shape

Published during `handleTransaction` — one event per currency per transaction (XRP bought and sold for that currency aggregated across all fills in the transaction):

```json
{
  "type": "xrp-demand",
  "currency": "USD",
  "xrpBought": "500.000000",
  "xrpSold": "700.000000",
  "ledgerIndex": 91234567
}
```

### REST response

```json
{
  "from": "2026-05-20T00:00:00.000Z",
  "to":   "2026-05-20T01:00:00.000Z",
  "buckets": [
    {
      "hour": "2026-05-20T00:00:00.000Z",
      "currency": "USD",
      "xrpBought": "1200.5",
      "xrpSold":   "800.25",
      "eventCount": 42
    }
  ]
}
```

---

## Client

### New / modified files

| File | Change |
|------|--------|
| `client/src/api/http.js` | Add `fetchXrpDemandBuckets(from, to)` |
| `client/src/hooks/useXrpDemandStream.js` | New hook — subscribes to `xrp-demand` WS events, accumulates live `stats: { [currency]: { bought, sold, balance, count } }`, returns `{ queue, setQueue, stats }` |
| `client/src/hooks/useXrpDemandHistory.js` | New hook — fetches and aggregates demand buckets; returns `{ summary, series, topCurrencies }` with 30s refetch |
| `client/src/components/XrpDemandView.jsx` | New component — mirrors `BridgeView` structure (ring SVG + sparkline + stats table) |
| `client/src/components/Dashboard.jsx` | Replace `mode === 'bridge'` branch with `mode === 'xrp-flow'`; render `<BridgeView />` and `<XrpDemandView />` side by side |
| `client/src/App.jsx` | Change `'bridge'` → `'xrp-flow'` in `MODES`; display label "XRP FLOW" |

### `useXrpDemandHistory` aggregation

`aggregateXrpDemandBuckets(buckets, timeWindow)` returns:
- `summary`: `{ [currency]: { bought, sold, balance, count } }` where `balance = bought - sold`
- `series`: array of `{ ts, currencies: { [currency]: xrpVolume } }` for sparkline (total = bought + sold)
- `topCurrencies`: top-N currencies by total XRP volume

### `XrpDemandView` ring visualization

- **Center node:** labeled "XRP" / "direct" (same teal styling as BridgeView's "XRP" / "bridge" node)
- **Ring nodes:** top IOU currencies (USD, EUR, BTC, …)
- **Solid edge** (currency → XRP): proportional to `xrp_sold` (XRP flowing toward the pair)
- **Dashed edge** (XRP → currency): proportional to `xrp_bought` (XRP flowing away)
- **Live animation:** one-leg particle
  - Buy event: particle animates currency → XRP center
  - Sell event: particle animates XRP center → currency
- **Window selector:** live / 10m / 1h / 24h (same `ToggleButtonGroup` as BridgeView)
- **Sparkline:** stacked bar of total XRP volume per currency per time bucket
- **Stats table columns:** Currency | XRP Bought | XRP Sold | Balance | Count

### Dashboard layout (mode = 'xrp-flow')

```jsx
<Box sx={{ display: 'flex', flex: 1, gap: 1.5, p: 1.5, minHeight: 0, overflow: 'auto' }}>
  <BridgeView />
  <XrpDemandView />
</Box>
```

Each view occupies 50% width naturally via flex.

---

## Testing

- **Unit:** `aggregateXrpDemandBuckets` — same test structure as `aggregateBridgeBuckets.test.js`; cover bought-only, sold-only, mixed, and multi-currency buckets
- **Integration:** `server/tests/integration/xrpDemandBuckets.test.js` — upsert accumulation, query by time range (same `test.skip` pattern as bridge integration tests)
- **Manual:** start app, observe XRP FLOW tab renders two panels; confirm demand view populates as trades occur

---

## Non-goals

- Per-issuer breakdown (all USD issuers collapsed to "USD")
- Replay controls (removed from BridgeView in prior iteration; not added here)
- Historical fill backfill (only tracks from first boot after schema migration)
