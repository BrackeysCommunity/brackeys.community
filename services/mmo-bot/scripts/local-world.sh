#!/usr/bin/env bash
# Runs a throwaway world for the bot on this machine: a private Postgres
# (the server on PATH) with the mmo migrations, a local Redis for the
# cooldowns, and the world service on :8080 with 30-second ticks.
# Everything lives under services/mmo-bot/out/ (gitignored); `stop` ends it
# and `wipe` deletes it. Never points at a shared database.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."
OUT="$PWD/out/local"
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
esac

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
[ -f "$OUT/master" ] || head -c 32 /dev/urandom | base64 >"$OUT/master"
(cd "$ROOT/services/mmo-world" && go build -o "$OUT/world" ./cmd/world)
(
  cd "$ROOT/services/mmo-world"
  DATABASE_URL="$DB" MMO_WORLD_ID="$WORLD" MMO_MASTER_SECRET="$(cat "$OUT/master")" MMO_ROLL_EPOCH=0 MMO_KEY_VERSION=1 \
    MMO_DISPOSABLE=1 MMO_TICK_SECONDS="${MMO_TICK_SECONDS:-30}" PORT="${PORT:-8080}" MMO_OPERATOR_TOKEN=local-operator \
    nohup "$OUT/world" >"$OUT/world.log" 2>&1 </dev/null &
  echo $! >"$OUT/world.pid"
)
for _ in $(seq 1 60); do
  curl -sf "http://localhost:${PORT:-8080}/healthz" >/dev/null && break
  kill -0 "$(cat "$OUT/world.pid")" 2>/dev/null || { tail -3 "$OUT/world.log"; exit 1; }
  sleep 1
done
echo "world $WORLD on http://localhost:${PORT:-8080}, Redis on :$REDISPORT, Postgres on :$PGPORT (logs in $OUT)"
