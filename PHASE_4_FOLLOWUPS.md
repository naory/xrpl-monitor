# Phase 4 — Follow-Ups

Non-blocking issues identified during Phase 4 review.

---

## FF-17: `totalFills` in /fills/stats is not window-scoped

**File:** `server/src/api/fills.js` — `/stats` handler

`totalFills` returns the all-time count of rows in `trade_fills`. The volume leaderboard is scoped to the requested window (10m/1h/24h) but the fill count is not, which can be misleading.

Options:
- Add a `fillsInWindow` field using `COUNT(*) WHERE ledger_time >= now - window`. Requires mapping the Redis window name to a Postgres interval.
- Or rename `totalFills` → `totalFillsAllTime` to make the scope explicit.

---

## FF-18: No index on (account, id) for account-filtered cursor pagination

**File:** `server/schema.sql`

`GET /fills?account=rXxx&cursor=N` produces:
```sql
WHERE id < $1 AND account = $2 ORDER BY id DESC LIMIT $3
```
This hits the `idx_fills_account` index but still must recheck `id < N`, which forces a sort/filter on the full account partition. For accounts with many fills, a composite index `(account, id DESC)` would allow index-only scans.

Add to schema.sql:
```sql
CREATE INDEX IF NOT EXISTS idx_fills_account_id ON trade_fills (account, id DESC);
```

---

## FF-19: `GET /fills?cursor=` with a non-numeric value is silently ignored

**File:** `server/src/db/fillQueries.js` — `buildFillsQuery`

If `cursor` is provided but not a valid integer (e.g. `?cursor=abc`), `parseInt` returns `NaN`, `Number.isFinite` is false, and the condition is silently skipped — returning the first page without error. A malformed cursor should return 400.

Fix: move cursor validation to the router layer alongside the limit validation.

---

## FF-20: Date filter accepts ambiguous partial date strings

**File:** `server/src/db/fillQueries.js` — `parseDate`

`new Date('2025')` is valid JS and produces `2025-01-01T00:00:00Z`. Users passing `?from=2025` will get results from Jan 1 2025 onwards — which may be intentional. Consider restricting to ISO 8601 full-precision format (e.g., `/^\d{4}-\d{2}-\d{2}/`) to avoid accidental mis-parses.

---

## FF-21: /fills/stats totalFills races with volume leaderboard

**File:** `server/src/api/fills.js`

`Promise.all([getVolumeLeaderboard, getFillCount])` runs both queries concurrently. The leaderboard is read from Redis (in-memory) while the count is read from Postgres. Between new fills being written to Postgres and volume being recorded to Redis, there is a brief window where the two can be out of sync. This is inherent to the dual-store design and acceptable for a leaderboard dashboard.
