#!/bin/sh
# Proves the live map (GDD 4.11): the read model's sight keys, fog and busy
# bands and the map style; a world saved before the live map reopening at
# its digest, in the sim and through the store, with no earlier draw moved;
# over HTTP, nothing of a tile nobody found on any layer, last-seen values
# kept until the viewer returns, no live layer to an anonymous viewer,
# /map's crop agreeing with the site's view tile for tile, busy bands that
# never place a character, writes that follow sight changes and the read
# caps; the Activity's map routes on the same filter; the map run at 1,
# which must hold map-load-budget and map-seen-cost, with the client's
# frames timed on its payloads and added to the modelled first draw; and
# no sim file modified.
#
#   sh scripts/mm13-proof.sh <out dir>
#
# The store and service tests need Postgres as they find it. The harness
# run uses SPIKE_WORKERS (6 unless set). Every step's output is kept in the
# out dir; the script exits non-zero on the first failure.
set -eu
export LC_ALL=C
cd "$(dirname "$0")/.."
OUT="${1:?usage: sh scripts/mm13-proof.sh <out dir>}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
SPIKE_WORKERS="${SPIKE_WORKERS:-6}"
export SPIKE_WORKERS

# The base MM13 builds on, and the tip the sim is frozen at: the base plus
# the owner's two ledger commits, which are not the map's.
BASE=08bd89192dc4f0247c5f086b4468f1f49de80177
FROZEN=e5d1914d9b8cb32cb309c493a5bd00f6a79ccff6
OWNER_SIM='491708b361105bd2a616d25d03c14c3956937c77 7a9f611e85d5f6985e89a2a01b0929a507c07806'

say() { echo "mm13-proof: $*"; }
fail() {
  say "FAIL: $*"
  exit 1
}

# step <name> <command...> runs a command with its output in <out>/<name>.log.
step() {
  name=$1
  shift
  say "$name: $*"
  if ! "$@" >"$OUT/$name.log" 2>&1; then
    tail -40 "$OUT/$name.log"
    fail "$name (see $OUT/$name.log)"
  fi
}

# passed <log> <test...> requires each test to have run and passed.
passed() {
  log=$1
  shift
  for t in "$@"; do
    grep -q "^--- PASS: $t " "$OUT/$log.log" || fail "$t did not run and pass (see $OUT/$log.log)"
  done
}

# holds <log> <target id> requires the report row of that target to read yes.
holds() {
  text="$(jq -r --arg id "$2" '.rows[] | select(.id == $id) | .text' sheets/meta/targets.json)"
  [ -n "$text" ] || fail "no target $2 in meta.targets"
  row="$(grep -F "| $text |" "$OUT/$1.log" || true)"
  [ -n "$row" ] || fail "the $1 run reports no row for $2"
  case "$row" in
  *"| yes |") say "$2 holds: $(echo "$row" | awk -F' [|] ' '{print $(NF-1)}')" ;;
  *) fail "$2 does not hold: $row" ;;
  esac
}

# runs <name...> is the names as one go test -run pattern.
runs() { echo "$*" | tr ' ' '|'; }

VIEW='TestSightKeyChanges TestOverlayNeverUndiscovered TestBusyBands TestMapStyleOf'
step view go test ./mapview ./render -count=1 -timeout 40m -v
# shellcheck disable=SC2086
passed view $VIEW

SIM='TestPreMM13WorldLoads TestNoDrawMoved'
# shellcheck disable=SC2086
step sim go test ./sim/game -run "$(runs $SIM)" -count=1 -timeout 40m -v
# shellcheck disable=SC2086
passed sim $SIM

STORE='TestPreMM13WorldLoads TestMapSeenStore'
# shellcheck disable=SC2086
step store go test ./store -run "$(runs $STORE)" -count=1 -timeout 40m -v
# shellcheck disable=SC2086
passed store $STORE

SERVICE='TestMapUndiscoveredReturnsNothing TestMapLastSeenKeepsOldThreat TestMapAnonymousNoLiveLayer TestMapCropAgreesWithSite TestMapBusyNoPosition TestMapSeenWritesOnSightChange TestMapReadCap TestMapOverlayHTTPBudget TestAPIMatchesRules'
# shellcheck disable=SC2086
step service go test ./service -run "$(runs $SERVICE)" -count=1 -timeout 40m -v
# shellcheck disable=SC2086
passed service $SERVICE
grep -q 'seen 2 world days ago' "$OUT/service.log" || fail "the last-seen test printed no two-day age"
say "last seen: $(grep -o 'A left home.*' "$OUT/service.log" | head -1)"
say "$(grep -o 'overlay over HTTP with Postgres: p95 [^,]*' "$OUT/service.log" | head -1)"

GATEWAY='TestActivityMapFilter TestActivityMapLimits'
# shellcheck disable=SC2086
step gateway go test ./gateway -run "$(runs $GATEWAY)" -count=1 -timeout 40m -v
# shellcheck disable=SC2086
passed gateway $GATEWAY

step map go run ./cmd/harness map -n 1 -out "$OUT/map-1"
holds map map-load-budget
holds map map-seen-cost
[ -f "$OUT/map-1/map.json" ] || fail "the map run wrote no map.json under $OUT/map-1"
[ -d "$OUT/map-1/dump" ] || fail "the map run wrote no payloads under $OUT/map-1/dump"

step client sh -c "cd ../../packages/mmo-map && MMO_MAP_DUMP='$OUT/map-1/dump' vp test run"
line="$(grep -o 'map client ([0-9]* tiles): .*' "$OUT/client.log" | head -1)"
[ -n "$line" ] || fail "the client test printed no times on the dump (see $OUT/client.log)"
say "$line"
[ -f "$OUT/map-1/dump/client.json" ] || fail "the client test wrote no client.json under $OUT/map-1/dump"
modelled="$(jq -r '.modelledMs' "$OUT/map-1/map.json")"
budget="$(jq -r '.firstDrawMs' "$OUT/map-1/map.json")"
frame="$(jq -r '.firstFrameMs' "$OUT/map-1/dump/client.json")"
total="$(echo "$modelled $frame" | awk '{printf "%.0f", $1 + $2}')"
modelled="$(echo "$modelled" | awk '{printf "%.0f", $1}')"
frame="$(echo "$frame" | awk '{printf "%.1f", $1}')"
if ! echo "$total $budget" | awk '{exit !($1 <= $2)}'; then
  fail "the modelled first draw is $total ms ($modelled ms to the client and a $frame ms first frame), over $budget ms"
fi
say "the modelled first draw is $total ms ($modelled ms to the client and a $frame ms first frame), within $budget ms"

frozen() {
  git diff --diff-filter=M --exit-code "$FROZEN" -- sim ':!sim/sheets/book.go' || return 1
  git diff --diff-filter=M --exit-code "$BASE" -- sim/game/testdata sim/world/testdata sim/puzzle/testdata || return 1
  touched="$(git log --format=%H "$BASE..$FROZEN" -- sim | sort | tr '\n' ' ')"
  owner="$(echo "$OWNER_SIM" | tr ' ' '\n' | sort | tr '\n' ' ')"
  [ "$touched" = "$owner" ] || {
    echo "the sim changed between the base and the frozen tip in $touched, not only the owner's $owner"
    return 1
  }
}
step frozen frozen
say "no sim file is modified since the frozen tip but the Book's two pack sheets, and no recorded fixture since the base"
say "holds: the sight keys, fog and busy bands and the style; the pre-MM13 world in the sim and the store; no draw moved; nothing unfound on any layer; last seen kept; nothing live to the anonymous; /map agreeing with the site; busy with no position; writes on sight change; the read caps; the Activity's map routes; the map run's load budget and seen cost; no sim file modified"
