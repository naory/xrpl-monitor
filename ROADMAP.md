# XRPL Monitor — Architecture & Roadmap

A greenfield redesign of the XRPL DEX tracker, built around the fundamental nature of the data: order book state is ephemeral and XRPL owns it; trade fills are the only durable record worth storing.

---

## Core Design Principles

1. **XRPL is the source of truth for order book state.** Don't try to maintain a local copy of live offers in a database. It will always be stale, and re-syncing it on every restart is what causes rate limit bursts.
2. **Trade fills are the durable record.** What actually executed — pair, volume, price, ledger index — is worth persisting. Pending offers are not.
3. **Ledger close is the natural processing boundary.** XRPL closes a ledger every ~3-4 seconds. Each closed ledger is complete and cryptographically verified. Use it as a batch boundary instead of processing individual transactions in isolation.
4. **Top-K pair tracking should be automatic.** No manual database inserts to add a tracked pair. Every pair observed in the transaction stream is a candidate; the most active ones rise naturally.

---

## Architecture Overview

```
XRPL WebSocket (wss://s1.ripple.com)
  │
  ├─ subscribe: transactions
  └─ subscribe: ledgerClosed
        │
        ▼
  ┌─────────────────────────────────┐
  │         Ingest Layer            │
  │                                 │
  │  On each transaction:           │
  │  ├─ parse OfferAffectedNodes    │
  │  ├─ extract fills (pair,        │
  │  │   volume, price, ledger)     │
  │  ├─ INCR Redis TopK             │
  │  ├─ append to Postgres          │
  │  └─ publish to Redis Pub/Sub    │
  │                                 │
  │  On each ledgerClosed:          │
  │  ├─ read current top-K          │
  │  ├─ diff vs active subs         │
  │  └─ subscribe / unsubscribe     │
  └─────────────────────────────────┘
        │                   │
        ▼                   ▼
  ┌──────────┐       ┌───────────────┐
  │  Redis   │       │  PostgreSQL   │
  │          │       │               │
  │  TopK    │       │  trade_fills  │
  │  Sorted  │       │  (append-only)│
  │  Sets    │       │               │
  │  Pub/Sub │       └───────────────┘
  │  Cache   │
  └──────────┘
        │
        ▼
  ┌─────────────────────────────────┐
  │         API / Push Layer        │
  │                                 │
  │  REST:  historical queries      │
  │         from Postgres           │
  │                                 │
  │  WS/SSE: subscribe to Redis     │
  │          Pub/Sub, forward to    │
  │          connected clients      │
  │                                 │
  │  Order book: fetched on-demand  │
  │  from XRPL or Redis cache       │
  └─────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────┐
  │         React Client            │
  └─────────────────────────────────┘
```

---

## Data Layer

### PostgreSQL — one table

```sql
CREATE TABLE trade_fills (
    id            SERIAL PRIMARY KEY,
    ledger_index  BIGINT NOT NULL,
    ledger_time   TIMESTAMP NOT NULL,
    tx_hash       VARCHAR(64) NOT NULL,
    account       VARCHAR(64) NOT NULL,            -- offer owner
    gets_currency VARCHAR(42) NOT NULL,
    gets_issuer   VARCHAR(64),
    gets_value    NUMERIC(38, 18) NOT NULL,
    pays_currency VARCHAR(42) NOT NULL,
    pays_issuer   VARCHAR(64),
    pays_value    NUMERIC(38, 18) NOT NULL,
    price         NUMERIC(38, 18) GENERATED ALWAYS AS (
                    CASE WHEN gets_value = 0 THEN NULL
                    ELSE pays_value / gets_value END
                  ) STORED
);

CREATE INDEX ON trade_fills (ledger_index);
CREATE INDEX ON trade_fills (gets_currency, pays_currency);
CREATE INDEX ON trade_fills (ledger_time);
```

No `offers` table. No `offer_history` table. No `tracked_pairs` table.

The `ledger_index` column is what allows gap detection on reconnect: on startup, read the highest `ledger_index` from the DB and compare against the current validated ledger index to know if you missed any history.

### Redis — four structures

**TopK** (`pairs:topk`)
- Redis Stack TopK data structure
- Key: canonical pair string e.g. `XRP/USD:rhub8...`
- Incremented on every observed fill
- Persistent via Redis AOF/RDB
- Query: `TOPK.LIST pairs:topk` → current top-K pairs by fill count

**Sorted sets** — volume windows (`vol:10m`, `vol:1h`, `vol:24h`)
- Member: pair key
- Score: cumulative volume
- Trimmed by timestamp on each ledger close using `ZREMRANGEBYSCORE`
- Gives ranked volume leaderboard per time window

**Order book cache** (`book:{pairkey}`)
- JSON snapshot of current bids/asks
- Written after each order book subscription snapshot
- TTL: one ledger close interval (~5 seconds)
- Client reads from here; misses fall through to a direct XRPL request

**Pub/Sub channels**
- `fills` — new trade fill events (real-time client push)
- `topk:changed` — emitted when top-K composition changes (triggers UI updates)
- `book:{pairkey}` — order book update for a specific pair

---

## Ingest Layer

### Transaction processing

XRPL `OfferCreate` transactions that result in a fill include an `AffectedNodes` array. Each `ModifiedNode` or `DeletedNode` of type `Offer` represents a fill event. This is where the actual trade data lives — not in the top-level transaction fields.

```
transaction (OfferCreate)
  └─ meta.AffectedNodes[]
       ├─ DeletedNode  (Offer fully consumed)  → full fill
       └─ ModifiedNode (Offer partially filled) → partial fill
            ├─ FinalFields  (state after)
            └─ PreviousFields (state before)
            → fill amount = PreviousFields - FinalFields
```

For each fill node, extract:
- `gets_currency`, `gets_issuer`, `gets_value`
- `pays_currency`, `pays_issuer`, `pays_value`
- `account` (the offer owner, from the node's `FinalFields.Account`)
- `tx_hash`, `ledger_index`, `ledger_time` (from the transaction envelope)

### Ledger close processing

On each `ledgerClosed` event:

1. **Trim volume windows** — remove entries older than the window from sorted sets
2. **Read top-K** — `TOPK.LIST pairs:topk`
3. **Diff subscriptions** — compare top-K against currently subscribed pairs
4. **Rebalance** — send XRPL `subscribe` for new pairs (with `snapshot: true`), `unsubscribe` for dropped pairs
5. **Seed cache** — write snapshot bids/asks from the subscription response into Redis order book cache
6. **Emit `topk:changed`** — if the composition changed, notify clients

### Gap detection on startup

```
startup:
  lastKnownLedger = SELECT MAX(ledger_index) FROM trade_fills
  currentLedger   = XRPL ledger_current RPC

  if (currentLedger - lastKnownLedger) > threshold:
    log warning: gap detected, historical fills may be missing
    // optionally: backfill via ledger history requests, one ledger at a time
    // this is rate-limit-safe because it's paced, not a burst
```

If the gap is acceptable (server was down for a short time), just start from the current ledger and acknowledge the gap in the health endpoint. If gap recovery is needed, request ledgers sequentially with a delay between each — not a parallel burst.

---

## Dynamic Pair Tracking

No `tracked_pairs` table. No manual management.

```
observed in stream → TOPK.INCR → rises in ranking
                                         │
                               ledger close: read top-K
                                         │
                               new in top-K → subscribe
                               dropped from top-K → unsubscribe
```

### Hysteresis

To prevent subscription churn from short-lived volume spikes, require a pair to appear in the top-K for **3 consecutive ledger-close cycles** before subscribing, and to drop out for **3 consecutive cycles** before unsubscribing. This is a simple counter per pair, stored in Redis.

### Cold start

On the very first boot (empty Redis, empty Postgres), there is no top-K signal yet. Seed with a minimal hardcoded list of well-known liquid pairs (XRP/USD, XRP/EUR, XRP/RLUSD) that gets replaced by real data within the first minute of operation. This list is config, not a database table.

---

## API Design

### REST (historical, from Postgres)

| Endpoint | Description |
|---|---|
| `GET /fills` | Recent trade fills, filterable by pair, account, time range |
| `GET /fills/stats` | Volume and trade count aggregates per pair per window |
| `GET /health` | XRPL connection status, last ledger index, gap info |

### Real-time (WebSocket or SSE)

| Channel | Payload |
|---|---|
| `fills` | New fill event as it's processed |
| `topk` | Current top-K ranking with volume and count |
| `book/{pair}` | Order book snapshot for a specific pair |

### Order book (on-demand)

`GET /book/{pair}` — serves from Redis cache if fresh, otherwise requests from XRPL and caches the result. Does not touch Postgres.

---

## Phases

### Phase 1 — Core ingest pipeline
- XRPL WebSocket connection with reconnect/backoff
- Ledger close subscription and batch boundary logic
- Fill extraction from `AffectedNodes`
- `trade_fills` Postgres table and writer
- Redis TopK increments
- Health endpoint with ledger gap detection

### Phase 2 — Dynamic subscriptions
- Order book subscription management driven by top-K
- Hysteresis logic for stable rebalancing
- Redis order book cache with TTL
- `GET /book/{pair}` endpoint

### Phase 3 — Real-time push
- Redis Pub/Sub publisher (fills, topk:changed, book updates)
- WebSocket server subscribing to Redis and forwarding to clients
- Volume sorted sets with window trimming

### Phase 4 — REST analytics
- `GET /fills` with filtering and pagination
- `GET /fills/stats` with time-window aggregation from sorted sets
- Historical volume charts from Postgres

### Phase 5 — Client
- React dashboard consuming REST + WebSocket
- Order book view, top-K leaderboard, fill stream, volume charts
- No hardcoded API URL — configured via `REACT_APP_API_URL`

---

## Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js | Consistent with existing tooling |
| XRPL client | `xrpl` npm package | Already proven in prior project |
| Database | PostgreSQL | Append-only fills, range queries |
| Cache / ranking | Redis Stack | TopK, Sorted Sets, Pub/Sub, persistence |
| API | Express | Minimal, well-understood |
| Real-time | `ws` + Redis Pub/Sub | Simple, decoupled from ingest |
| Client | React + MUI v7 | Carry forward from prior project |
| State | Zustand + React Query | Carry forward from prior project |
| Infra | Docker Compose | Postgres + Redis + server in one command |

---

## What This Eliminates vs. Prior Project

| Problem | Root cause | Eliminated because |
|---|---|---|
| Rate limit burst on startup | HTTP backfill of order book state | Order book state not stored in DB |
| Reconnect desync | Mutable `offers` table drifts from truth | No mutable offer state |
| Manual pair management | Static `tracked_pairs` table | Top-K drives subscriptions automatically |
| Analytics lost on restart | In-memory TradingPairsTracker | Redis TopK is persistent |
| Hardcoded API URL | No env var | Env var from day one |
| Broken test suite | No module boundaries | Fill extraction and TopK logic are pure functions, easily unit tested |
