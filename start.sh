#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Check Docker daemon is running; start Colima if available
if ! docker info &>/dev/null 2>&1; then
  if command -v colima &>/dev/null; then
    echo "[start] Docker daemon not running — starting Colima..."
    colima start
  else
    echo "[start] Error: Docker daemon is not running." >&2
    exit 1
  fi
fi

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
until docker exec xrpl_monitor_pg pg_isready -U xrpl -d xrpl_monitor -q 2>/dev/null; do
  printf "."; sleep 1
done
echo " ready."

# Wait for Redis — use BF.EXISTS to confirm the BloomFilter module is loaded,
# not just that the core server is up (redis-stack loads modules after PING responds).
printf "[start] Waiting for Redis"
until docker exec xrpl_monitor_redis redis-cli bf.exists _healthcheck _ 2>/dev/null | grep -qE '^[01]$'; do
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

echo "[start] All components running. Ctrl+C to stop server+client (Postgres/Redis keep running)."
echo "[start] To stop infrastructure: docker stop xrpl_monitor_pg xrpl_monitor_redis"

cleanup() {
  echo ""
  echo "[start] Stopping server and client..."
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  echo "[start] Done. Postgres and Redis are still running."
}
trap cleanup INT TERM

wait "$SERVER_PID" "$CLIENT_PID"
