#!/usr/bin/env bash
# A throwaway Postgres 16 for the integration tests, with the app's
# migrations applied. Prints the CANVAS_SYNC_TEST_DATABASE_URL to export.
#
#   test/scratch-pg.sh start [dir]   # default dir: ${TMPDIR:-/tmp}/canvas-sync-pg
#   test/scratch-pg.sh stop [dir]
#
# PG_BIN overrides where initdb/pg_ctl live (Homebrew's postgresql@16 by default);
# PG_PORT the port (55433).
set -euo pipefail
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

cmd="${1:-start}"
dir="${2:-${TMPDIR:-/tmp}/canvas-sync-pg}"
bin="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
port="${PG_PORT:-55433}"
root="$(cd "$(dirname "$0")/../../.." && pwd)"
url="postgresql://$(whoami)@127.0.0.1:${port}/canvas_sync_test"

case "$cmd" in
  start)
    if [ ! -d "$dir/data" ]; then
      mkdir -p "$dir"
      "$bin/initdb" -D "$dir/data" -A trust -U "$(whoami)" >/dev/null
    fi
    if ! "$bin/pg_ctl" -D "$dir/data" status >/dev/null 2>&1; then
      "$bin/pg_ctl" -D "$dir/data" -l "$dir/log" -o "-p $port -c unix_socket_directories='' -c max_connections=200" -w start >/dev/null
    fi
    "$bin/createdb" -h 127.0.0.1 -p "$port" canvas_sync_test 2>/dev/null || true
    (cd "$root" && DATABASE_URL="$url" vp exec drizzle-kit migrate >/dev/null)
    echo "export CANVAS_SYNC_TEST_DATABASE_URL=$url"
    ;;
  stop)
    "$bin/pg_ctl" -D "$dir/data" -m fast stop
    ;;
  *)
    echo "usage: $0 start|stop [dir]" >&2
    exit 2
    ;;
esac
