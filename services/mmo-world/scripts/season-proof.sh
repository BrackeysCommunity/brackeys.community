#!/usr/bin/env bash
# Proves a world saved before seasons starts one when a build that keeps
# them opens it (GDD 12.6). It founds a world with <base>'s build, walks a
# character a few tiles, stops it, opens the same database with this tree's
# build (MMO_SHEETS_FROM re-stamps the sheets, the open sends the one-shot
# season-start), and checks the log says SEASON STARTED, op story shows a
# legacy season (the weather's season length, not season zero's), the
# character walks on, and a second open sends no second start.
#
#   scripts/season-proof.sh <base commit> <out dir>
#
# Ports come from PORT (18080) and PGPORT (15439). The out dir holds a
# throwaway worktree, the builds, Postgres and the logs; its contents are
# removed unless KEEP=1. Keep its path short: Postgres's socket lives in it.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."
BASE="${1:?usage: scripts/season-proof.sh <base commit> <out dir>}"
OUT="${2:?usage: scripts/season-proof.sh <base commit> <out dir>}"
mkdir -p "$OUT"
PORT="${PORT:-18080}"
PGPORT="${PGPORT:-15439}"
WORLD=w-season-proof
TOKEN=season-proof
URL="http://localhost:$PORT"
PGBIN="$(dirname "$(readlink -f "$(command -v postgres)")")"
DB="postgres://postgres@localhost:$PGPORT/postgres?sslmode=disable"
STEPS="${STEPS:-3}"
TICKS_PER_DAY=144

stop_world() {
  [ -f "$OUT/world.pid" ] && kill "$(cat "$OUT/world.pid")" 2>/dev/null || true
  for _ in $(seq 1 30); do [ -f "$OUT/world.pid" ] && kill -0 "$(cat "$OUT/world.pid")" 2>/dev/null || break; sleep 1; done
  rm -f "$OUT/world.pid"
}
cleanup() {
  stop_world
  "$PGBIN/pg_ctl" -D "$OUT/pg" stop -m fast >/dev/null 2>&1 || true
  git worktree remove --force "$OUT/base" >/dev/null 2>&1 || true
  if [ "${KEEP:-0}" != 1 ]; then
    rm -rf "$OUT/base" "$OUT/pg" "$OUT/world-base" "$OUT/world-new" "$OUT/op" "$OUT/seq" "$OUT"/*.log "$OUT"/*.json
    rmdir "$OUT" 2>/dev/null || true
  fi
}
trap cleanup EXIT

say() { echo "season-proof: $*"; }
fail() { say "FAIL: $*"; exit 1; }

param() { jq -r --arg id "$2" '[.rows[] | select(.id == $id) | .value][0]' "$1"; }
SEASON_DAYS="$(param sheets/world/params.json season-days)"
ZERO_DAYS="$(param sheets/story/params.json season-zero-days)"
[ "$SEASON_DAYS" != "$ZERO_DAYS" ] || fail "season zero lasts as long as a season, so a legacy season cannot be told from it"

[ -e "$OUT/base" ] && git worktree remove --force "$OUT/base" >/dev/null 2>&1
git worktree add --detach "$OUT/base" "$BASE" >/dev/null 2>&1
(cd "$OUT/base/services/mmo-world" && go build -o "$OUT/world-base" ./cmd/world)
go build -o "$OUT/world-new" ./cmd/world
go build -o "$OUT/op" ./cmd/op
say "built $BASE and this tree"

rm -rf "$OUT/pg"
"$PGBIN/initdb" -D "$OUT/pg" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$OUT/pg" -o "-p $PGPORT -k $OUT" -l "$OUT/pg.log" start >/dev/null
migrations() { grep -o '\.\./\.\./drizzle/[^ ]*migration.sql' "$1/sqlc.yaml"; }
migrate() {
  for m in "$@"; do
    "$PGBIN/psql" -q -v ON_ERROR_STOP=1 -h localhost -p "$PGPORT" -U postgres -f "$m" >/dev/null
  done
}
(cd "$OUT/base/services/mmo-world" && migrate $(migrations .))

# start_world <binary> <module dir> [VAR=value...]
start_world() {
  local bin=$1 dir=$2
  shift 2
  (
    cd "$dir"
    env DATABASE_URL="$DB" MMO_WORLD_ID="$WORLD" MMO_MASTER_SECRET="$(head -c 32 /dev/zero | base64)" \
      MMO_ROLL_EPOCH=0 MMO_KEY_VERSION=1 MMO_DISPOSABLE=1 MMO_TICK_SECONDS=3 PORT="$PORT" \
      MMO_OPERATOR_TOKEN="$TOKEN" "$@" nohup "$bin" >>"$OUT/world.log" 2>&1 </dev/null &
    echo $! >"$OUT/world.pid"
  )
  for _ in $(seq 1 90); do
    curl -sf "$URL/healthz" | jq -e '.ok' >/dev/null 2>&1 && return 0
    kill -0 "$(cat "$OUT/world.pid")" 2>/dev/null || { tail -5 "$OUT/world.log"; fail "the world did not start"; }
    sleep 1
  done
  fail "the world never became healthy"
}

get() { curl -sf "$URL$1"; }
act() { curl -s -X POST -H 'content-type: application/json' -d "$1" "$URL/v1/actions"; }
tick() { get /healthz | jq -r '.tick'; }
story() { MMO_URL="$URL" MMO_OPERATOR_TOKEN="$TOKEN" "$OUT/op" story; }
# next_id counts in a file: it runs in command substitutions, whose
# variables never reach the caller.
next_id() {
  local n=$(($(cat "$OUT/seq" 2>/dev/null || echo 0) + 1))
  echo "$n" >"$OUT/seq"
  echo "season-proof-$1-$n"
}

# settle waits until the character stands still and out of any fight,
# pressing a fight's first option when one opens.
settle() {
  for _ in $(seq 1 200); do
    local o
    o="$(get "/v1/options?characterId=$CHAR")"
    if [ "$(jq -r '.fight != null' <<<"$o")" = true ]; then
      local opt v
      opt="$(jq -r '.fight.default // .fight.options[0].id' <<<"$o")"
      v="$(jq -r '.version' <<<"$o")"
      act "{\"interactionId\":\"$(next_id press)\",\"characterId\":\"$CHAR\",\"version\":$v,\"kind\":\"press\",\"option\":\"$opt\"}" >/dev/null
    elif [ "$(jq -r '.long == null' <<<"$o")" = true ]; then
      return 0
    fi
    sleep 1
  done
  fail "the character never stood still"
}

at() { get "/v1/character?id=$CHAR" | jq -c '.at'; }

# walk takes up to n open steps onto tiles not walked before, each waited
# out until the character stands on the next tile, and sets WALKED to the
# count.
walk() {
  local n=$1 from d v
  WALKED=0
  for _ in $(seq 1 "$n"); do
    settle
    from="$(at)"
    d="$(get "/v1/options?characterId=$CHAR" | jq -r --argjson avoid "$PATH_WALKED" \
      '[.moves[] | select(.open) | select((.to | {q, r}) as $t | ($avoid | index([$t]) | not))][0].dir // empty')"
    [ -n "$d" ] || break
    v="$(get "/v1/options?characterId=$CHAR" | jq -r '.version')"
    act "{\"interactionId\":\"$(next_id step)\",\"characterId\":\"$CHAR\",\"version\":$v,\"kind\":\"step\",\"dir\":$d}" |
      jq -e '.character and (.duplicate | not)' >/dev/null || fail "step $d refused"
    for _ in $(seq 1 120); do
      sleep 1
      settle
      [ "$(at)" != "$from" ] && break
    done
    [ "$(at)" != "$from" ] || fail "step $d from $from never landed"
    PATH_WALKED="$(jq -c --argjson h "$(at)" '. + [$h]' <<<"$PATH_WALKED")"
    WALKED=$((WALKED + 1))
  done
}

say "opening the world on $BASE's build"
start_world "$OUT/world-base" "$OUT/base/services/mmo-world"
act "{\"interactionId\":\"$(next_id create)\",\"discordId\":\"season-proof\",\"kind\":\"create\"}" | jq -e '.character' >/dev/null ||
  fail "create refused"
CHAR="$(get "/v1/player?discordId=season-proof" | jq -r '.characterId')"
settle
PATH_WALKED="[$(at)]"
walk "$STEPS"
[ "$WALKED" -gt 0 ] || fail "the character took no step at $BASE"
before="$(tick)"
say "walked $WALKED tiles at $BASE, tick $before"
stop_world
grep -q "SEASON STARTED" "$OUT/world.log" && fail "$BASE's build already starts seasons"
from="$("$PGBIN/psql" -tA -h localhost -p "$PGPORT" -U postgres -c "select sheets_digest from mmo.world where id = '$WORLD'")"
founded="$(grep -c "world founded" "$OUT/world.log" || true)"

comm -13 <(cd "$OUT/base/services/mmo-world" && migrations . | sort) <(migrations . | sort) >"$OUT/new-migrations.log"
migrate $(cat "$OUT/new-migrations.log")
say "opening it on this tree's build, MMO_SHEETS_FROM=$from"
start_world "$OUT/world-new" "$PWD" MMO_SHEETS_FROM="$from"
grep -q "SHEETS RESTAMPED" "$OUT/world.log" || fail "the sheets were not re-stamped"
grep -q "SHEETS CHANGED" "$OUT/world.log" && fail "the world was wiped instead of kept"
[ "$(grep -c "world founded" "$OUT/world.log")" = "$founded" ] || fail "the world was founded again"
[ "$(grep -c "SEASON STARTED" "$OUT/world.log")" = 1 ] || fail "SEASON STARTED was not logged once at open"
say "logged: $(grep "SEASON STARTED" "$OUT/world.log" | tail -1)"
after="$(tick)"
[ "$after" -ge "$before" ] || fail "the world opened at tick $after, behind $before"

story >"$OUT/story.json" || fail "op story failed"
jq -e --argjson days "$SEASON_DAYS" --argjson tick "$after" --argjson tpd "$TICKS_PER_DAY" \
  '.season.days == $days and .season.n == (($tick / $tpd / $days) | floor) and .season.ends == (.season.n + 1) * $days * $tpd' \
  "$OUT/story.json" >/dev/null || fail "op story shows no legacy season of $SEASON_DAYS days: $(jq -c '.season' "$OUT/story.json")"
say "op story: $(jq -c '.season' "$OUT/story.json") (season zero would last $ZERO_DAYS days)"

walk 1
[ "$WALKED" = 1 ] || fail "the character could not walk on after the season started"
[ "$(tick)" -gt "$after" ] || fail "the world does not tick on"
say "the character walked on at tick $(tick)"

stop_world
start_world "$OUT/world-new" "$PWD"
[ "$(grep -c "SEASON STARTED" "$OUT/world.log")" = 1 ] || fail "a second open started the season again"
story >"$OUT/story-again.json" || fail "op story failed after the second open"
jq -e --slurpfile was "$OUT/story.json" '.season.n == $was[0].season.n and .season.days == $was[0].season.days and .season.ends == $was[0].season.ends' \
  "$OUT/story-again.json" >/dev/null || fail "the season moved across a restart: $(jq -c '.season' "$OUT/story-again.json")"
stop_world
say "holds: $BASE's world loads on this build, starts a legacy season once, and plays on"
