#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Prefer docker compose (v2 plugin) over docker-compose (v1 standalone)
if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose &>/dev/null; then
  DC="docker-compose"
else
  echo "[start] Error: neither 'docker compose' nor 'docker-compose' found." >&2
  exit 1
fi

# Start infrastructure
echo "[start] Starting Postgres and Redis..."
$DC up -d postgres redis

# Wait for Postgres
printf "[start] Waiting for Postgres"
until $DC exec -T postgres pg_isready -U xrpl -d xrpl_monitor -q 2>/dev/null; do
  printf "."; sleep 1
done
echo " ready."

# Wait for Redis
printf "[start] Waiting for Redis"
until $DC exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; do
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
  $DC stop postgres redis
  echo "[start] Done."
}
trap cleanup INT TERM

wait "$SERVER_PID" "$CLIENT_PID"
