#!/usr/bin/env bash
# Runs a world for the bot on this machine: a private Postgres (the server
# on PATH) with the mmo migrations, a local Redis for the cooldowns, and
# the world service on :8080 with 30-second ticks. Never points at a
# shared database.
#
# Everything lives under MMO_LOCAL_OUT (default services/mmo-bot/out/local,
# gitignored; a relative path is read from where the script is run). Keep
# it short: Postgres's socket sits in it and its path must stay under
# about 100 characters. `stop` ends the world, `wipe` also deletes it.
#
# A disposable world by default. MMO_KEPT=1 runs a kept one instead, as
# players keep it: no MMO_DISPOSABLE, and an MMO_API_TOKEN generated once
# into $MMO_LOCAL_OUT/api-token (never printed; clients read the file).
# MMO_SHEETS_ROOT, MMO_SHEETS_FROM, MMO_SHEETS_NEXT, MMO_ROLL_EPOCH,
# MMO_ROLL_EPOCH_NEXT, MMO_MANUAL_CLOCK and MMO_FORGET_TOKEN are passed to
# the world when set. Each start builds the world to a new file name, so a
# running world's binary is never overwritten.
set -euo pipefail
export LC_ALL=C
CALLER="$PWD"
cd "$(dirname "$0")/.."
OUT="${MMO_LOCAL_OUT:-$PWD/out/local}"
case "$OUT" in /*) ;; *) OUT="$CALLER/$OUT" ;; esac
PGBIN="$(dirname "$(readlink -f "$(command -v postgres)")")"
PGPORT="${PGPORT:-55432}"
REDISPORT="${REDISPORT:-6390}"
WORLD="${MMO_WORLD_ID:-w-local}"
ROOT="$(git rev-parse --show-toplevel)"

stop() {
  [ -f "$OUT/world.pid" ] && kill "$(cat "$OUT/world.pid")" 2>/dev/null || true
  "$PGBIN/pg_ctl" -D "$OUT/pg" stop -m fast >/dev/null 2>&1 || true
  [ -f "$OUT/redis.pid" ] && kill "$(cat "$OUT/redis.pid")" 2>/dev/null || true
  rm -f "$OUT"/*.pid
}

case "${1:-start}" in
stop) stop; exit 0 ;;
wipe) stop; rm -rf "$OUT"; exit 0 ;;
start) ;;
*) echo "usage: local-world.sh [start|stop|wipe]" >&2; exit 2 ;;
esac

if [ -f "$OUT/world.pid" ] && kill -0 "$(cat "$OUT/world.pid")" 2>/dev/null; then
  echo "a world already runs from $OUT (pid $(cat "$OUT/world.pid")): stop it first" >&2
  exit 1
fi

mkdir -p "$OUT"
if [ ! -d "$OUT/pg" ]; then
  "$PGBIN/initdb" -D "$OUT/pg" -U postgres -A trust >/dev/null
  fresh=1
fi
"$PGBIN/pg_ctl" -D "$OUT/pg" -o "-p $PGPORT -k $OUT" -l "$OUT/pg.log" start >/dev/null
DB="postgres://postgres@localhost:$PGPORT/postgres?sslmode=disable"
if [ "${fresh:-0}" = 1 ]; then
  for m in $(grep -o '\.\./\.\./drizzle/[^ ]*migration.sql' "$ROOT/services/mmo-world/sqlc.yaml"); do
    "$PGBIN/psql" -q -v ON_ERROR_STOP=1 -h localhost -p "$PGPORT" -U postgres -f "$ROOT/services/mmo-world/$m" >/dev/null
  done
fi
redis-server --port "$REDISPORT" --save "" --daemonize yes --pidfile "$OUT/redis.pid" >/dev/null
umask 077
[ -f "$OUT/master" ] || head -c 32 /dev/urandom | base64 >"$OUT/master"

# The world env: the fixed local values, then what the caller passes through.
envs=(DATABASE_URL="$DB" MMO_WORLD_ID="$WORLD" MMO_ROLL_EPOCH="${MMO_ROLL_EPOCH:-0}" MMO_KEY_VERSION=1
  MMO_TICK_SECONDS="${MMO_TICK_SECONDS:-30}" PORT="${PORT:-8080}" MMO_OPERATOR_TOKEN=local-operator)
if [ "${MMO_KEPT:-0}" = 1 ]; then
  [ -s "$OUT/api-token" ] || head -c 24 /dev/urandom | base64 | tr -d '/+=' >"$OUT/api-token"
  envs+=(MMO_API_TOKEN="$(cat "$OUT/api-token")")
else
  envs+=(MMO_DISPOSABLE=1)
fi
for name in MMO_SHEETS_ROOT MMO_SHEETS_FROM MMO_SHEETS_NEXT MMO_ROLL_EPOCH_NEXT MMO_MANUAL_CLOCK MMO_FORGET_TOKEN; do
  if [ -n "${!name:-}" ]; then envs+=("$name=${!name}"); fi
done

# Old builds are removed only here, with no world running from them.
rm -f "$OUT"/world-*
BIN="$OUT/world-$(date +%s)-$$"
(cd "$ROOT/services/mmo-world" && go build -o "$BIN" ./cmd/world)
(
  cd "$ROOT/services/mmo-world"
  # Exported, not passed as arguments, so no secret shows in a process list.
  for e in "${envs[@]}"; do export "${e?}"; done
  MMO_MASTER_SECRET="$(cat "$OUT/master")" nohup "$BIN" >"$OUT/world.log" 2>&1 </dev/null &
  echo $! >"$OUT/world.pid"
)
for _ in $(seq 1 60); do
  curl -sf "http://localhost:${PORT:-8080}/healthz" >/dev/null && break
  kill -0 "$(cat "$OUT/world.pid")" 2>/dev/null || { tail -3 "$OUT/world.log"; exit 1; }
  sleep 1
done
kind="disposable"
if [ "${MMO_KEPT:-0}" = 1 ]; then kind="kept, API token in $OUT/api-token"; fi
echo "world $WORLD ($kind) on http://localhost:${PORT:-8080}, Redis on :$REDISPORT, Postgres on :$PGPORT (logs in $OUT)"
