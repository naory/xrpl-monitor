# Phase 2 Follow-ups (non-blocking)

---

## FF-7: PairRegistry is in-memory — pair details lost on restart

**Current behaviour:** `PairRegistry` is a `Map` that repopulates from live transactions after
restart. During the first few ledger closes, newly promoted pairs cannot be subscribed because
their currency details are not yet known.

**Proposed fix (Phase 3):** When a fill is written to Postgres, also write the pair's currency
details to a Redis Hash (`pair:meta:{pairKey}`). On startup, load all known pairs from Redis
into the registry before the XRPL connection is established.

---

## FF-8: Order book cache is TTL-only — no event-driven refresh

**Current behaviour:** The Redis order book cache expires after 10 seconds. There is no mechanism
to update it when a transaction modifies an offer in the subscribed book. The cache is only
refreshed when a new subscription snapshot is taken (on promotion).

**Proposed fix (Phase 3):** In `handleTransaction`, after writing fills, check if the affected
pair is in `subscribedKeys`. If so, push a lightweight cache-refresh event (or update the cached
order book in-place based on the fill delta). Alternatively, re-request the order book snapshot
on each ledger close for subscribed pairs — one `book_offers` request per pair per 3-4 seconds
is well within rate limits.

---

## FF-9: `requestOrderBook` on cache miss is unbounded latency

**Current behaviour:** `GET /book` falls back to a live XRPL `book_offers` WS request on cache
miss. If the XRPL node is slow or the request queues behind reconnect, this can take several
seconds and block the HTTP response.

**Proposed fix (Phase 3/4):** Add a timeout to `requestOrderBook` (e.g., 3 seconds). Return
`503` if the XRPL request does not complete in time, rather than hanging indefinitely. Also
consider pre-warming the cache for known subscribed pairs on server startup.

---

## FF-10: No WebSocket / SSE push to clients yet

**Current behaviour:** All data is pull-only (REST). Clients polling `/book` or `/health`
get stale data between polls. There is no mechanism to push fill events or order book changes
to connected browsers.

**Proposed fix (Phase 3):** Implement Redis Pub/Sub publisher in `handleTransaction` (emit on
`fills` channel) and in the rebalance loop (emit on `topk:changed`). Add an SSE or WebSocket
endpoint that subscribes to those channels and forwards events to connected clients.

---

## FF-11: Subscription snapshot may be paginated (large order books)

**Current behaviour:** `subscribeOrderBook` uses `snapshot: true` and returns whatever XRPL
sends back. For very deep order books, XRPL may paginate results via a `marker` field —
the current code does not handle this and will silently return a partial snapshot.

**Proposed fix (Phase 3):** After receiving the subscription snapshot, check for a `marker`
field in the result. If present, issue additional `book_offers` requests (with the marker)
to fetch remaining pages and merge them into the cached snapshot.
