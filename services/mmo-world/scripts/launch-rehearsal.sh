#!/usr/bin/env bash
# The launch rehearsal (GDD 18.5): a kept local world at 3-second ticks
# plays season zero on the base book with two servers, takes this tree's
# book as its rules epoch at the close, and plays season one's first world
# day. The bot's posters follow both servers beside it. Then it checks the
# world logged EPOCH TAKEN once, stored the epoch's notes, began season 1,
# keeps both servers' houses apart (each its own guild at its own
# settlement, each with its saved channels), audits clean, and replays
# season one's first day from its snapshot.
#
#   BASE_ROOT=<a base checkout's services/mmo-world> scripts/launch-rehearsal.sh <out dir>
#   BASE=<base commit> scripts/launch-rehearsal.sh <out dir>   (a throwaway worktree of it under the out dir)
#
# The out dir holds Postgres (TCP only, no socket), the binaries, the
# world's secrets (generated, mode 600, never printed) and the logs. The
# world, Postgres and the bot are stopped on exit and the database and
# binaries removed unless KEEP=1; logs and the season run's outputs stay.
# PORT (18080) and PGPORT (15439) pick the ports; TICK_SECONDS (3) the
# tick; HARNESS a prebuilt harness binary; POSTERS=off leaves the bot out.
# About 1.9 hours at 3-second ticks.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."
HERE="$PWD"
OUT="${1:?usage: BASE_ROOT=<base services/mmo-world> scripts/launch-rehearsal.sh <out dir>}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
PORT="${PORT:-18080}"
PGPORT="${PGPORT:-15439}"
TICK_SECONDS="${TICK_SECONDS:-3}"
POSTERS="${POSTERS:-on}"
WORLD=w-rehearsal
URL="http://localhost:$PORT"
PGBIN="$(dirname "$(readlink -f "$(command -v postgres)")")"
DB="postgres://postgres@localhost:$PGPORT/postgres?sslmode=disable"
TICKS_PER_DAY=144
SEASON_CAP=$((3 * 3600))
POSTERS_WAIT=600
STAMP="$(git rev-parse --short=12 HEAD)-$(date +%s)"
BIN="$OUT/bin"

say() { echo "launch-rehearsal: $*"; }
fail() {
  say "FAIL: $*"
  exit 1
}

stop_pid() {
  local f=$1
  [ -f "$f" ] || return 0
  kill "$(cat "$f")" 2>/dev/null || true
  for _ in $(seq 1 30); do kill -0 "$(cat "$f")" 2>/dev/null || break; sleep 1; done
  kill -9 "$(cat "$f")" 2>/dev/null || true
  rm -f "$f"
}
cleanup() {
  stop_pid "$OUT/posters.pid"
  stop_pid "$OUT/season.pid"
  stop_pid "$OUT/world.pid"
  "$PGBIN/pg_ctl" -D "$OUT/pg" stop -m fast >/dev/null 2>&1 || true
  if [ -n "${MADE_BASE:-}" ]; then git worktree remove --force "$OUT/base" >/dev/null 2>&1 || true; fi
  if [ "${KEEP:-0}" != 1 ]; then
    rm -rf "$OUT/pg" "$BIN" "$OUT/secrets"
  fi
}
trap cleanup EXIT

if [ -z "${BASE_ROOT:-}" ]; then
  [ -n "${BASE:-}" ] || fail "give BASE_ROOT (a base checkout's services/mmo-world) or BASE (a commit)"
  [ -e "$OUT/base" ] && git worktree remove --force "$OUT/base" >/dev/null 2>&1
  git worktree add --detach "$OUT/base" "$BASE" >/dev/null 2>&1
  MADE_BASE=1
  BASE_ROOT="$OUT/base/services/mmo-world"
fi
BASE_ROOT="$(cd "$BASE_ROOT" && pwd)"
[ -d "$BASE_ROOT/sheets" ] || fail "$BASE_ROOT holds no sheets/"

mkdir -p "$BIN"
go build -o "$BIN/world-$STAMP" ./cmd/world
go build -o "$BIN/op-$STAMP" ./cmd/op
HARNESS="${HARNESS:-$BIN/harness-$STAMP}"
[ -x "$HARNESS" ] || go build -o "$HARNESS" ./cmd/harness
FROM="$(cd "$BASE_ROOT" && "$HARNESS" digest)"
TO="$("$HARNESS" digest)"
[ "$FROM" != "$TO" ] || fail "the base book and this tree's are the same book ($FROM): nothing to take"
say "base book $FROM, launch book $TO"

(umask 077 && mkdir -p "$OUT/secrets")
gen() { (umask 077 && head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' >"$OUT/secrets/$1"); }
(umask 077 && head -c 32 /dev/urandom | base64 >"$OUT/secrets/master")
gen api-token
gen operator-token

rm -rf "$OUT/pg"
"$PGBIN/initdb" -D "$OUT/pg" -U postgres -A trust >/dev/null
printf "port = %s\nunix_socket_directories = ''\nlisten_addresses = 'localhost'\n" "$PGPORT" >>"$OUT/pg/postgresql.conf"
"$PGBIN/pg_ctl" -D "$OUT/pg" -l "$OUT/pg.log" -w start >/dev/null
psql_() { "$PGBIN/psql" -q -v ON_ERROR_STOP=1 -h localhost -p "$PGPORT" -U postgres "$@"; }
for m in $(grep -o '\.\./\.\./drizzle/[^ ]*migration.sql' sqlc.yaml); do psql_ -f "$m" >/dev/null; done
say "Postgres on :$PGPORT with this tree's migrations"

# world_env runs the world (or op replay, which loads it) with its
# environment, and client_env a client of it with its tokens alone. The
# secrets are prefix assignments, so they reach the child's environment and
# never an argument list the process table shows; the master never leaves
# the world's.
world_env() {
  DATABASE_URL="$DB" MMO_WORLD_ID="$WORLD" MMO_MASTER_SECRET="$(cat "$OUT/secrets/master")" MMO_ROLL_EPOCH=0 MMO_KEY_VERSION=1 \
    MMO_API_TOKEN="$(cat "$OUT/secrets/api-token")" MMO_OPERATOR_TOKEN="$(cat "$OUT/secrets/operator-token")" env "$@"
}
client_env() {
  MMO_URL="$URL" MMO_API_TOKEN="$(cat "$OUT/secrets/api-token")" MMO_OPERATOR_TOKEN="$(cat "$OUT/secrets/operator-token")" env "$@"
}
(
  world_env MMO_SHEETS_ROOT="$BASE_ROOT" MMO_SHEETS_NEXT="$HERE" MMO_TICK_SECONDS="$TICK_SECONDS" PORT="$PORT" \
    nohup "$BIN/world-$STAMP" >"$OUT/world.log" 2>&1 </dev/null &
  echo $! >"$OUT/world.pid"
)
for _ in $(seq 1 120); do
  curl -sf "$URL/healthz" 2>/dev/null | jq -e '.standby != true' >/dev/null 2>&1 && break
  kill -0 "$(cat "$OUT/world.pid")" 2>/dev/null || {
    tail -5 "$OUT/world.log"
    fail "the world did not start"
  }
  sleep 1
done
curl -sf "$URL/healthz" | jq -e '.standby != true' >/dev/null || fail "the world never became healthy"
grep '"world founded"' "$OUT/world.log" | grep -q '"disposable":false' || fail "the world was not founded kept: $(grep '"world founded"' "$OUT/world.log" | cut -c1-200)"
say "a kept world on $URL at ${TICK_SECONDS}-second ticks, on the base book, the launch book pending"

if [ "$POSTERS" != off ]; then
  (
    cd ../mmo-bot
    env MMO_URL="$URL" MMO_API_TOKEN="$(cat "$OUT/secrets/api-token")" nohup bun run src/scripted.ts --posters "$URL" --guilds live-a,live-b >"$OUT/posters.log" 2>&1 </dev/null &
    echo $! >"$OUT/posters.pid"
  )
  say "the bot's posters follow live-a and live-b"
fi

say "playing season zero and season one's first world day (harness season -live -servers 2 -on 1)"
client_env SPIKE_WORKERS="${SPIKE_WORKERS:-6}" "$HARNESS" season -live "$URL" -servers 2 -on 1 -out "$OUT/season" -label rehearsal \
  >"$OUT/season.log" 2>&1 &
pid=$!
echo "$pid" >"$OUT/season.pid"
(sleep "$SEASON_CAP" && kill "$pid" 2>/dev/null) &
watchdog=$!
status=0
wait "$pid" || status=$?
kill "$watchdog" 2>/dev/null || true
wait "$watchdog" 2>/dev/null || true
rm -f "$OUT/season.pid"
[ "$status" = 0 ] || {
  tail -5 "$OUT/season.log"
  fail "the season run exited $status"
}
SUM="$OUT/season/season-live.json"
[ -f "$SUM" ] || fail "the season run wrote no season-live.json"
CLOSE="$(jq -r '.closedTick' "$SUM")"
jq -e '.closed' "$SUM" >/dev/null || fail "season zero never closed"
say "season zero closed at tick $CLOSE; the run ended at tick $(jq -r '.end' "$SUM")"

if [ "$POSTERS" != off ]; then
  for _ in $(seq 1 "$POSTERS_WAIT"); do
    kill -0 "$(cat "$OUT/posters.pid")" 2>/dev/null || break
    sleep 1
  done
  stop_pid "$OUT/posters.pid"
  tail -1 "$OUT/posters.log" | jq -e . >/dev/null 2>&1 || fail "the posters printed no summary line (posters.log)"
  tail -1 "$OUT/posters.log" | jq -e '(.ok // true) and ((.problems // []) | length == 0)' >/dev/null ||
    fail "the posters found a problem: $(tail -1 "$OUT/posters.log" | cut -c1-300)"
  say "posters: $(tail -1 "$OUT/posters.log" | cut -c1-200)"
fi

taken="$(grep -c "EPOCH TAKEN" "$OUT/world.log" || true)"
[ "$taken" = 1 ] || fail "EPOCH TAKEN logged $taken times, want once"
stamped="$(psql_ -tA -c "select sheets_digest from mmo.world where id = '$WORLD'")"
[ "$stamped" = "$TO" ] || fail "the world is stamped $stamped, not the launch book $TO"
notes="$(psql_ -tA -c "select count(*) from mmo.epoch_note where world_id = '$WORLD' and season = 1 and from_digest = '$FROM' and to_digest = '$TO'")"
[ "$notes" = 1 ] || fail "$notes stored epoch notes for season 1 from $FROM to $TO, want 1"
jq -e --arg to "$TO" '.epochs | length == 1 and .[0].to == $to and (.[0].seen + .[0].unseen) > 0' "$SUM" >/dev/null ||
  fail "the promotions route served no season.epoch to the launch book with its notes: $(jq -c '.epochs' "$SUM")"
jq -e --argjson close "$CLOSE" '.began["1"] == $close' "$SUM" >/dev/null || fail "season.began for season 1 not at the close: $(jq -c '.began' "$SUM")"
say "the epoch: taken once, stamped, notes stored ($(jq -c '.epochs[0] | {seen, unseen}' "$SUM")), season 1 began at tick $CLOSE"

jq -e '.houses | length == 2 and all(.guild != "" and .channels > 0 and .players > 0) and (.[0].arrival != .[1].arrival) and (.[0].guild != .[1].guild)' "$SUM" >/dev/null ||
  fail "the two servers' houses are not apart: $(jq -c '.houses' "$SUM")"
for server in live-a live-b; do
  curl -sf -H "Authorization: Bearer $(cat "$OUT/secrets/api-token")" "$URL/v1/house?server=$server" | jq -e '.guild != "" and (.settlements | length) > 0' >/dev/null ||
    fail "GET /v1/house?server=$server shows no guild at a settlement"
done
say "houses: $(jq -c '[.houses[] | {server, guild, arrival}]' "$SUM")"

client_env "$BIN/op-$STAMP" audit >"$OUT/audit.json" || fail "op audit failed"
jq -e '(.discrepancies // []) | length == 0' "$OUT/audit.json" >/dev/null || fail "op audit: $(cut -c1-300 "$OUT/audit.json")"
stop_pid "$OUT/world.pid"
world_env MMO_SHEETS_ROOT="$HERE" "$BIN/op-$STAMP" replay -from "$CLOSE" -to "$((CLOSE + TICKS_PER_DAY))" >"$OUT/replay.json" ||
  fail "op replay over season one's first day: $(tail -3 "$OUT/replay.json")"
say "op audit clean; op replay $(jq -c '{from, to, checked, actions}' "$OUT/replay.json")"
say "holds: season zero on the base book, the launch book taken at the close, season one's first day in two servers"
