# XRP Bridge Utility Visualizer — Design Spec

**Date:** 2026-05-08
**Status:** Approved

## Goal

Add a "Bridge" tab to the existing Dashboard that visualizes XRP's role as a bridge asset in real time. Animated particle flows show auto-bridged trades routing through XRP as they happen on the ledger, with a session-accumulating stats table below listing bridged volume per currency.

---

## What is Auto-Bridging

When a trader creates an offer to swap TokenA for TokenB, the XRPL DEX may automatically route through XRP if that produces a better fill price than the direct order book. In the transaction metadata, this appears as two sets of consumed offers within a single transaction:

- Offers from the TokenA/XRP book (`getsCurrency=XRP, paysCurrency=TokenA`)
- Offers from the XRP/TokenB book (`getsCurrency=TokenB, paysCurrency=XRP`)

The discriminator: XRP appears on **both** sides of the fills within the same `txHash`. A direct XRP trade only has XRP on one side.

---

## Bridge Detection Logic

`extractFills(event)` returns all fills for one transaction in a single array. Bridge detection is a pure pass over that array:

```
source legs  =  fills where getsCurrency === 'XRP'
dest legs    =  fills where paysCurrency === 'XRP'
bridged      =  source legs.length > 0 AND dest legs.length > 0
```

Reconstructed bridge event fields:

| Field | Derived From |
|---|---|
| `fromCurrency` | `paysCurrency` of source-leg fills |
| `fromIssuer` | `paysIssuer` of source-leg fills |
| `fromValue` | sum of `paysValue` of source-leg fills |
| `toCurrency` | `getsCurrency` of dest-leg fills |
| `toIssuer` | `getsIssuer` of dest-leg fills |
| `toValue` | sum of `getsValue` of dest-leg fills |
| `xrpValue` | sum of `getsValue` of source-leg fills (XRP intermediary) |

A single transaction may produce one bridge event. If fills have XRP on only one side (direct XRP trade), no bridge event is emitted.

---

## Backend Pipeline

### New: `server/src/ingest/bridgeDetector.js`

Pure function. Takes fills array, returns array of bridge events (zero or one per call in practice).

```js
detectBridges(fills) → BridgeEvent[]
```

No I/O, no side effects.

### New: `server/src/redis/bridgePublisher.js`

Publishes to Redis channel `bridge:fill`. Same pattern as `publishFill` in `redis/publisher.js`.

```js
publishBridge(redis, bridgeEvent) → Promise<void>
```

### Modified: `server/src/ingest/ledgerProcessor.js`

In `handleTransaction`, after the existing `extractFills` + `writeFills` block:

```js
const bridges = detectBridges(fills);
for (const b of bridges) {
  publishBridge(redis, b).catch(err => console.error('[BRIDGE]', err.message));
}
```

### Modified: `server/src/api/ws.js`

Subscribe to `bridge:fill` Redis channel and broadcast to WebSocket clients. Same pattern as the existing fill subscription.

---

## WebSocket Event Shape

```json
{
  "type": "bridge:fill",
  "txHash": "ABC123...",
  "ledgerIndex": 12345,
  "fromCurrency": "USD",
  "fromIssuer": "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  "fromValue": "50.00",
  "toCurrency": "EUR",
  "toIssuer": "rEzTZonArMskGLkMygGRGuLngGZzfvTGkK",
  "toValue": "46.00",
  "xrpValue": "100.00"
}
```

---

## Frontend

### New: `client/src/hooks/useBridgeStream.js`

Subscribes to `bridge:fill` WS events. Maintains:

- `queue` — FIFO array of pending bridge events to animate
- `stats` — session accumulator: `{ [currency]: { volume: number, count: number } }`

Stats update immediately on receipt. The queue feeds the animation independently.

### New: `client/src/components/BridgeView.jsx`

SVG ring visualization + stats table.

**Ring:**
- Currencies seen in the session are placed on a circle, evenly spaced, up to 12 nodes max. Currencies beyond 12 are still tracked in stats but not added to the ring.
- XRP rendered at center with a glow effect.
- Each bridge event animates two particle legs: source → XRP (leg 1), then XRP → dest (leg 2).
- Leg 2 starts only after leg 1 completes. XRP node pulses between legs.

**Animation queue:**
- An `animating` ref tracks whether a flow is in progress.
- When `animating === false` and `queue.length > 0`, dequeue the next event and start animation.
- Events queue up without being dropped — high-volume periods animate sequentially.

**Stats table:**
- Rows sorted by descending bridged volume.
- Columns: Currency | Bridged Volume (XRP) | Flow count. Volume per row is the sum of `xrpValue` from all bridge events involving that currency (the XRP that flowed through as intermediary).
- Totals accumulate for the session lifetime (reset on page refresh).
- Only currencies with at least one flow are shown.

### Modified: `client/src/components/Dashboard.jsx`

Add "Bridge" tab. Renders `<BridgeView />` when active. No other changes.

---

## What This Does NOT Do

- No persistence — bridge events are not written to `trade_fills` or any other DB table.
- No time-window aggregation — stats are session-only, not 10m/1h/24h.
- No historical replay — the visualization starts from the moment the tab is opened.
- No changes to OHLCV, volume leaderboard, or pair grid.
