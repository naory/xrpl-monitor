# Phase 1 Follow-ups (non-blocking)

These issues were identified during the Phase 1 PR review but are not blocking merge.
They should be addressed in Phase 2 or as a dedicated cleanup PR.

---

## FF-1: `getLastLedgerIndex` on startup does not handle gaps > threshold

**Current behaviour:** On startup, the server logs the last known ledger and reports the
gap in `/health`, but takes no remediation action. There is no warning log at the ingest
layer, and the health endpoint only flags it — it does not surface the missing ledger range.

**Proposed fix (Phase 2):** Log an explicit `[WARN] Ledger gap detected: missed ledgers
{from}–{to}` at startup. In Phase 4 (REST analytics), add the gap range to the
`/health` response so operators can decide whether to backfill manually.

---

## FF-2: `writeFills` uses a per-transaction DB client, not a batch writer

**Current behaviour:** `writeFills` acquires one PG client per call and executes one
`INSERT` per fill inside a transaction. For a burst of transactions in a busy ledger,
this means many sequential round-trips.

**Proposed fix (Phase 3/4):** Buffer fills for the duration of one ledger close cycle
(~4 seconds), then flush the entire batch in a single `COPY` or multi-value `INSERT`.
The `handleLedgerClosed` hook is the natural flush boundary.

---

## FF-3: Redis TopK `WITHCOUNT` may not be available in older Redis Stack versions

**Current behaviour:** `getTopK` calls `TOPK.LIST pairs:topk WITHCOUNT`, which returns
interleaved `[key, count, key, count, ...]`. This flag was added in Redis Stack 2.0.
Older versions return only keys.

**Proposed fix (Phase 2):** Add a startup check that calls `TOPK.INFO pairs:topk` and
logs the Redis Stack version. Fall back to `TOPK.LIST` (without count) if needed.

---

## FF-4: No error boundary around `incrementPairs` in `ledgerProcessor`

**Current behaviour:** If Redis is temporarily unreachable, `incrementPairs` throws,
is caught, and the error is logged — but the fill was already written to Postgres.
On the next boot, the TopK will not reflect fills that were written during the Redis
outage.

**Proposed fix (Phase 3):** Track a `last_topk_synced_ledger` in Redis. On startup,
if `last_topk_synced_ledger < last_known_ledger`, replay fills from Postgres into
the TopK to close the gap.

---

## FF-5: `xrplClient.js` does not emit the current ledger index on `ledgerClosed`

**Current behaviour:** `handleLedgerClosed` in `ledgerProcessor` sets `state.currentLedger`
from the event, but `xrplClient` wires the raw XRPL event directly. If the XRPL event
shape changes (e.g. nested `ledger` object), `event.ledger_index` will be `undefined`
silently.

**Proposed fix (Phase 2):** Add a thin adapter in `xrplClient` that normalises the
ledger close event to `{ ledgerIndex, txnCount, closeTime }` before passing it to the
callback, so `ledgerProcessor` is decoupled from raw XRPL event shapes.

---

## FF-6: No `.env` file for local development without Docker

**Current behaviour:** `.env.example` exists but requires manual copy to `.env`.
The server will fail at startup with unhelpful Postgres connection errors if the DB
is not running and no env vars are set.

**Proposed fix:** Add a `README.md` in Phase 2 with quickstart instructions
(copy `.env.example` → `.env`, run `docker-compose up`, then `npm start`).
