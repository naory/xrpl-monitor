#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Start infrastructure
echo "[start] Starting Postgres and Redis..."
docker compose -f "$ROOT/docker-compose.yml" up -d postgres redis

# Wait for Postgres
printf "[start] Waiting for Postgres"
until docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
    pg_isready -U xrpl -d xrpl_monitor -q 2>/dev/null; do
  printf "."; sleep 1
done
echo " ready."

# Wait for Redis
printf "[start] Waiting for Redis"
until docker compose -f "$ROOT/docker-compose.yml" exec -T redis \
    redis-cli ping 2>/dev/null | grep -q PONG; do
  printf "."; sleep 1
done
echo " ready."

# Start server
echo "[start] Starting server (port 3001)..."
(cd "$ROOT/server" && npm run dev) &
SERVER_PID=$!

# Start client
echo "[start] Starting client (port 3000)..."
(cd "$ROOT/client" && npm run dev) &
CLIENT_PID=$!

echo "[start] All components running. Ctrl+C to stop."

cleanup() {
  echo ""
  echo "[start] Stopping server and client..."
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  echo "[start] Stopping Postgres and Redis..."
  docker compose -f "$ROOT/docker-compose.yml" stop postgres redis
  echo "[start] Done."
}
trap cleanup INT TERM

wait "$SERVER_PID" "$CLIENT_PID"
