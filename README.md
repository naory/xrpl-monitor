# XRPL Monitor

Real-time XRPL DEX trade fill tracker with dynamic top-K pair discovery.

## Architecture

- **Ingest:** XRPL WebSocket → extract trade fills from `AffectedNodes` → Postgres + Redis
- **Pair ranking:** Redis Stack `TopK` — every observed pair is a candidate; most active rise automatically
- **Dynamic subscriptions:** Hysteresis-gated order book subscriptions driven by top-K rebalancing on each ledger close
- **API:** REST for historical fills; live order book served from Redis cache with XRPL fallback

See [ROADMAP.md](ROADMAP.md) for the full architecture design.

## Quickstart

```bash
cp .env.example .env
docker-compose up -d
```

The server starts on `http://localhost:3001` once Postgres and Redis are healthy.

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | XRPL, DB, Redis status + ledger gap detection |
| `GET /book?getsCurrency=XRP&paysCurrency=USD&paysIssuer=rXXX` | Order book (Redis cache → XRPL fallback) |

## Development

```bash
cd server
npm install
npm test              # unit tests (no infra needed)
npm run test:integration  # requires docker-compose up
npm run dev           # runs with --watch
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `XRPL_NET` | `mainnet` | `mainnet`, `testnet`, or a full `wss://` URL |
| `PGHOST` | `localhost` | Postgres host |
| `PGPORT` | `5434` | Postgres port (5434 = docker-compose mapping) |
| `PGUSER` | `xrpl` | Postgres user |
| `PGPASSWORD` | `xrplpass` | Postgres password |
| `PGDATABASE` | `xrpl_monitor` | Postgres database |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6380` | Redis port (6380 = docker-compose mapping) |
| `PORT` | `3001` | API server port |
