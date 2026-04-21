# Phase 5 — Follow-Ups

Non-blocking issues identified during Phase 5 review.

---

## FF-22: Bundle splitting — single 1 MB chunk

**File:** `client/vite.config.js`

The production build emits one 1.06 MB JS chunk (~330 kB gzip). Heavy libraries
(MUI, Recharts, Framer Motion, TradingView) all land in the same bundle.

Add manual chunk hints to Rollup:
```javascript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        vendor:   ['react', 'react-dom'],
        mui:      ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
        charts:   ['recharts', 'lightweight-charts'],
        motion:   ['framer-motion', '@react-spring/web'],
        query:    ['@tanstack/react-query', 'zustand', 'axios'],
      },
    },
  },
},
```

---

## FF-23: PriceChart — no REST pre-population on pair select

**File:** `client/src/components/PriceChart.jsx`

When a pair is selected, the chart only shows fills that arrived via WebSocket
since the client connected. Historical fills available from `GET /fills` are
not loaded.

Fix: in the `selectedPair` effect, call `fetchFills({ getCurrency, payCurrency, limit: 200 })`
and seed `series.setData()` with those points before streaming new WS fills on top.

Note: the `pairKey` normalization means the pair direction needs to be decoded to
determine which side is gets/pays for the filter.

---

## FF-24: OrderBook price calculation uses `|| 1` guard

**File:** `client/src/components/OrderBook.jsx` — `processOffers`

`parseOfferAmount(o.TakerGets) || 1` prevents division-by-zero but produces an
incorrect price (numerically equal to `paysValue`) when `TakerGets` is truly 0.
A zero-size offer shouldn't reach the order book, but the guard should return
`null` and filter out the entry rather than displaying a wrong price.

---

## FF-25: WebSocket reconnect resets fill history

**File:** `client/src/api/socket.js`

On reconnect, the Zustand fills array retains the old fills but new arrivals
are prepended normally. There's no deduplication — if the server replays a
recent fill (e.g., due to a race on reconnect), it will appear twice in the
stream.

Fix: use `txHash + account` as a dedup key in `addFill`. A `Set` of recent
hashes (capped at 200) would prevent duplicates without a full array scan.

---

## FF-26: No loading skeleton / error boundary in Dashboard

**File:** `client/src/components/Dashboard.jsx`

If the REST API is down on first load, `Leaderboard` shows "No volume data yet"
and `OrderBook` waits silently. There's no top-level error boundary or
user-visible "API unreachable" state.

Add a React `ErrorBoundary` wrapper and a banner when `/health` returns non-200.

---

## FF-27: `PriceChart` fills direction is not normalized

**File:** `client/src/components/PriceChart.jsx`

The price for a fill is computed as `paysValue / getsValue`. For a pair like
`USD|rI~XRP|` the chart shows "XRP per USD", but a fill where XRP is the gets
side would show "USD per XRP" (the reciprocal) on the same chart, creating a
discontinuous price series.

Fix: pick a canonical quote currency from the pairKey and invert the price for
fills where the canonical currency is on the gets side.
