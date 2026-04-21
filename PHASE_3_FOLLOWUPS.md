# Phase 3 — Follow-Ups

Non-blocking issues identified during Phase 3 review. Address in Phase 4 or a dedicated hardening pass.

---

## FF-12: WebSocket heartbeat for dead connections

**File:** `server/src/api/ws.js`

`wss.clients` retains connections where the underlying TCP link dropped without a clean WebSocket close. These stale clients accumulate silently and waste broadcast iterations.

Add a `setInterval` ping/pong cycle: send `ws.ping()` every 30s and mark clients that haven't responded with `ws.terminate()`. Standard pattern documented in the `ws` package README.

---

## FF-13: Redis Pub/Sub subscription race at startup

**File:** `server/src/api/ws.js`

`subscriber.subscribe(...)` is fire-and-forget (`.then/.catch`). If a WebSocket client connects in the brief window between server start and subscription acknowledgement, messages published in that window are dropped silently.

Options:
- Expose a `ready` promise from `createWebSocketServer` so `index.js` can await full subscription before accepting HTTP connections.
- Or: track a `subscribed` flag and buffer messages received before the flag is set.

---

## FF-14: `ledgerTime` raw-number passthrough in publisher

**File:** `server/src/redis/publisher.js` — `buildFillMessage`

The `else` branch of the `ledgerTime instanceof Date` check passes the value through unchanged. In the current code path, `fillExtractor.js` always produces a `Date` object, so this is safe. However, if any future caller passes a raw XRPL epoch integer (seconds since 2000-01-01), it would serialize as a number rather than an ISO string — breaking client consumers expecting a string.

Consider replacing the branch with an explicit type guard that converts numbers via `new Date((n + RIPPLE_EPOCH) * 1000).toISOString()` and throws on unexpected types.

---

## FF-15: Volume leaderboard cleanup threshold

**File:** `server/src/redis/volume.js` — `trimWindows`

`zremrangebyscore(RANK_KEY(window), '-inf', 0)` removes pairs with score ≤ 0. After floating-point subtraction, a pair's score can reach a small negative rather than exactly zero; these are cleaned up correctly. However, pairs with very low but positive residual volume (e.g., 0.000001 XRP due to sub-millisecond timestamp boundary conditions) are never purged, leading to leaderboard clutter for truly inactive pairs.

Consider a configurable `minVolume` threshold below which pairs are removed from the rank set.

---

## FF-16: `publishBookUpdate` reserved for Phase 4

**File:** `server/src/redis/publisher.js`

`CHANNELS.BOOK` (the per-pair channel generator) remains exported but `publishBookUpdate` was removed as dead code in Phase 3. Phase 4 will implement order book streaming via `subscriptionManager → publishBookUpdate → WS clients`. The channel naming convention (`book:{pairKey}`) is established; the WS server will need to subscribe to per-pair channels dynamically when clients request a specific order book view.
