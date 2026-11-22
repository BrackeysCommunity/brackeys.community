#!/usr/bin/env bash
# Proves a world saved before content was drawn from history keeps what
# its discovered tiles held when a build that draws content opens it
# (GDD 4.17). It founds a world with <old>'s build, walks a character a few
# tiles, stops it, opens the same database with this tree's build
# (MMO_SHEETS_FROM re-stamps the sheets, the open freezes the world), walks
# back over the same tiles comparing what a player reads on each, then out
# onto tiles nobody has reached, whose content must be drawn.
#
#   scripts/freeze-proof.sh <old commit> [out dir]
#
# Ports come from PORT (18080) and PGPORT (15439). The out dir holds a
# throwaway worktree, both builds, Postgres and the reads; it is removed
# unless KEEP=1. Keep its path short: Postgres's socket lives in it.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."
OLD="${1:?usage: scripts/freeze-proof.sh <old commit> [out dir]}"
OUT="${2:-${TMPDIR:-/tmp}/freeze-proof}"
mkdir -p "$OUT"
PORT="${PORT:-18080}"
PGPORT="${PGPORT:-15439}"
WORLD=w-freeze-proof
TOKEN=freeze-proof
URL="http://localhost:$PORT"
PGBIN="$(dirname "$(readlink -f "$(command -v postgres)")")"
DB="postgres://postgres@localhost:$PGPORT/postgres?sslmode=disable"
STEPS="${STEPS:-4}"

stop_world() {
  [ -f "$OUT/world.pid" ] && kill "$(cat "$OUT/world.pid")" 2>/dev/null || true
  for _ in $(seq 1 30); do [ -f "$OUT/world.pid" ] && kill -0 "$(cat "$OUT/world.pid")" 2>/dev/null || break; sleep 1; done
  rm -f "$OUT/world.pid"
}
cleanup() {
  stop_world
  "$PGBIN/pg_ctl" -D "$OUT/pg" stop -m fast >/dev/null 2>&1 || true
  git worktree remove --force "$OUT/old" >/dev/null 2>&1 || true
  [ "${KEEP:-0}" = 1 ] || rm -rf "$OUT"
}
trap cleanup EXIT

say() { echo "freeze-proof: $*"; }
fail() { say "FAIL: $*"; exit 1; }

[ -e "$OUT/old" ] && git worktree remove --force "$OUT/old" >/dev/null 2>&1
git worktree add --detach "$OUT/old" "$OLD" >/dev/null 2>&1
(cd "$OUT/old/services/mmo-world" && go build -o "$OUT/world-old" ./cmd/world)
go build -o "$OUT/world-new" ./cmd/world
say "built $OLD and this tree"

rm -rf "$OUT/pg"
"$PGBIN/initdb" -D "$OUT/pg" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$OUT/pg" -o "-p $PGPORT -k $OUT" -l "$OUT/pg.log" start >/dev/null
migrations() { grep -o '\.\./\.\./drizzle/[^ ]*migration.sql' "$1/sqlc.yaml"; }
migrate() {
  for m in "$@"; do
    "$PGBIN/psql" -q -v ON_ERROR_STOP=1 -h localhost -p "$PGPORT" -U postgres -f "$m" >/dev/null
  done
}
(cd "$OUT/old/services/mmo-world" && migrate $(migrations .))

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
op() { curl -sf -H "authorization: Bearer $TOKEN" "$URL$1"; }
act() { curl -s -X POST -H 'content-type: application/json' -d "$1" "$URL/v1/actions"; }
# next_id counts in a file: it runs in command substitutions, whose
# variables never reach the caller.
next_id() {
  local n=$(($(cat "$OUT/seq" 2>/dev/null || echo 0) + 1))
  echo "$n" >"$OUT/seq"
  echo "freeze-proof-$1-$n"
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

# step <dir>: one step, waited out until the character stands on the
# next tile.
step() {
  local from v
  from="$(at)"
  v="$(get "/v1/options?characterId=$CHAR" | jq -r '.version')"
  act "{\"interactionId\":\"$(next_id step)\",\"characterId\":\"$CHAR\",\"version\":$v,\"kind\":\"step\",\"dir\":$1}" |
    jq -e '.character and (.duplicate | not)' >/dev/null || fail "step $1 refused"
  for _ in $(seq 1 120); do
    sleep 1
    settle
    [ "$(at)" != "$from" ] && return 0
  done
  fail "step $1 from $from never landed"
}

at() { get "/v1/character?id=$CHAR" | jq -c '.at'; }

# read_here is what a player reads on the tile it stands on, less what
# moves with the clock (weather, road wear, wanderers).
read_here() {
  get "/v1/here?characterId=$CHAR" | jq -S -c '{tile: (.place.tile | del(.weather, .road)), explore: .place.explore,
    materials, residents: [.people[] | select(.kind == "resident") | {id, name, role, traits}], dungeon, search}'
}

# open_dir is an open step from here onto a tile not in the given list.
open_dir() {
  get "/v1/options?characterId=$CHAR" | jq -r --argjson avoid "$1" \
    '[.moves[] | select(.open) | select((.to | {q, r}) as $t | ($avoid | index([$t]) | not))][0].dir // empty'
}

say "opening the world on $OLD's build"
start_world "$OUT/world-old" "$OUT/old/services/mmo-world"
act "{\"interactionId\":\"$(next_id create)\",\"discordId\":\"freeze-proof\",\"kind\":\"create\"}" | jq -e '.character' >/dev/null ||
  fail "create refused"
CHAR="$(get "/v1/player?discordId=freeze-proof" | jq -r '.characterId')"
settle
# The settlement is discovered by the arrival's visit, a tick after create.
until [ "$(get "/v1/here?characterId=$CHAR" | jq '.place.tile.found')" -gt 0 ]; do sleep 1; done
path="[$(at)]"
read_here >"$OUT/before.jsonl"
for _ in $(seq 1 "$STEPS"); do
  d="$(open_dir "$path")"
  [ -n "$d" ] || break
  step "$d"
  path="$(jq -c --argjson h "$(at)" '. + [$h]' <<<"$path")"
  read_here >>"$OUT/before.jsonl"
done
say "walked $(jq length <<<"$path") tiles at $OLD: $path"
stop_world
from="$("$PGBIN/psql" -tA -h localhost -p "$PGPORT" -U postgres -c "select sheets_digest from mmo.world where id = '$WORLD'")"

comm -13 <(cd "$OUT/old/services/mmo-world" && migrations . | sort) <(migrations . | sort) >"$OUT/new-migrations"
migrate $(cat "$OUT/new-migrations")
say "opening it on this tree's build, MMO_SHEETS_FROM=$from"
start_world "$OUT/world-new" "$PWD" MMO_SHEETS_FROM="$from"
grep -q "SHEETS RESTAMPED" "$OUT/world.log" || fail "the sheets were not re-stamped"
grep -q "CONTENT FROZEN" "$OUT/world.log" || fail "the world was not frozen at open"
settle

for h in $(jq -c '.[]' <<<"$path"); do
  q="$(jq .q <<<"$h")" r="$(jq .r <<<"$h")"
  op "/v1/operator/tile?q=$q&r=$r" | jq -e '.state.content.native == true' >/dev/null || fail "$q,$r was not frozen native"
done
say "every walked tile holds native content"

# Walk back over the same tiles, reading each again.
here="$(at)"
[ "$here" = "$(jq -c '.[-1]' <<<"$path")" ] || fail "the character moved while the world was down"
read_here >"$OUT/after.jsonl"
for i in $(seq $(($(jq length <<<"$path") - 2)) -1 0); do
  to="$(jq -c ".[$i]" <<<"$path")"
  d="$(get "/v1/options?characterId=$CHAR" | jq -r --argjson t "$to" '[.moves[] | select((.to | {q, r}) == $t)][0].dir')"
  step "$d"
  [ "$(at)" = "$to" ] || fail "the walk back missed $to"
  read_here >>"$OUT/after.jsonl"
done
awk '{l[NR] = $0} END {for (i = NR; i > 0; i--) print l[i]}' "$OUT/after.jsonl" >"$OUT/after-ordered.jsonl"
if ! cmp -s "$OUT/before.jsonl" "$OUT/after-ordered.jsonl"; then
  diff "$OUT/before.jsonl" "$OUT/after-ordered.jsonl" || true
  fail "a discovered tile reads differently after the freeze"
fi
say "every walked tile reads byte for byte as at $OLD ($(wc -l <"$OUT/before.jsonl" | tr -d ' ') tiles)"

# Out onto tiles nobody reached: each is drawn from history.
drawn=0
known="$path"
for _ in $(seq 1 "$STEPS"); do
  d="$(open_dir "$known")"
  [ -n "$d" ] || break
  step "$d"
  h="$(at)"
  known="$(jq -c --argjson h "$h" '. + [$h]' <<<"$known")"
  q="$(jq .q <<<"$h")" r="$(jq .r <<<"$h")"
  c="$(op "/v1/operator/tile?q=$q&r=$r" | jq -c '.state.content')"
  jq -e '(.native // false) == false and (.key // "") != ""' <<<"$c" >/dev/null || fail "$q,$r was not drawn from history: $c"
  say "drawn $q,$r: $(jq -c '{siteKind, lead, stock}' <<<"$c")"
  drawn=$((drawn + 1))
done
[ "$drawn" -gt 0 ] || fail "no undiscovered tile was reached"
say "holds: $drawn new tiles drawn from history"
