#!/usr/bin/env bash
set -e

echo "[stop] Stopping Postgres and Redis..."
docker stop xrpl_monitor_pg xrpl_monitor_redis
echo "[stop] Done."
