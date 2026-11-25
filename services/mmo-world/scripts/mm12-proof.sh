#!/bin/sh
# Proves live operations and moderation (GDD 14, 10.8, 4.17): staging by
# a server's admins and staff, the staged carrier and its guard, the staged
# xp allowance, moderation that never touches the ledger, terrain pins and
# their validator, and a world saved before MM12 reopening unremarked with
# no earlier draw moved (in the sim and through the store); the house over
# HTTP; the Search run aimed at staging at 20, which must hold
# staging-stays-local, staged-goods-local and staged-xp-cap with a clean
# audit; the terrain sweep at 20, which must hold terrain-pins-hold and
# refuse at least one pin for a route or a cut; and the seen record's four
# verdict lines at 4.
#
#   sh scripts/mm12-proof.sh <out dir>
#
# The store and service tests need Postgres as they find it. The harness
# runs use SPIKE_WORKERS (6 unless set). Every step's output is kept in the
# out dir; the script exits non-zero on the first failure.
set -eu
export LC_ALL=C
cd "$(dirname "$0")/.."
OUT="${1:?usage: sh scripts/mm12-proof.sh <out dir>}"
mkdir -p "$OUT"
SPIKE_WORKERS="${SPIKE_WORKERS:-6}"
export SPIKE_WORKERS

say() { echo "mm12-proof: $*"; }
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

SIM='TestHouseStaging TestStagedPaths TestStagedGuard TestStagedXPAllowance TestModerationNoLedger TestModerationGates TestOverlayRoutes TestTerrainPinRefused TestTerrainPinAccepted TestScaffoldPureWithPins TestPreMM12WorldLoads TestNoDrawMoved'
step sim go test ./sim/gen ./sim/world ./sim/game -run "$(echo "$SIM" | tr ' ' '|')" -count=1 -timeout 40m -v
# shellcheck disable=SC2086
passed sim $SIM

step store go test ./store -run 'TestPreMM12WorldLoads|TestHouseLog' -count=1 -timeout 40m -v
passed store TestPreMM12WorldLoads TestHouseLog
step service go test ./service -run 'TestHouseOverHTTP|TestAPIMatchesRules' -count=1 -timeout 40m -v
passed service TestHouseOverHTTP TestAPIMatchesRules

step search go run ./cmd/harness search -n 20 -out "$OUT/search-20"
holds search staging-stays-local
holds search staged-goods-local
holds search staged-xp-cap
ls "$OUT"/search-20/*.md >/dev/null 2>&1 || fail "the Search run wrote no report under $OUT/search-20"
# The conservation audit reads into the gate's own line, which says clean
# only when no audit line and no staged leak was found.
if grep -lE 'discrepanc|conservation: ' "$OUT"/search-20/*.md "$OUT/search.log" >/dev/null 2>&1; then
  fail "the Search run's audit found discrepancies: $(grep -hE 'discrepanc|conservation: ' "$OUT"/search-20/*.md "$OUT/search.log" | head -3)"
fi
grep -q 'staged-goods-local`): clean' "$OUT"/search-20/*.md || fail "the Search run's report shows no clean audit"
say "the Search run's audit is clean"

step terrain go run ./cmd/harness terrain -n 20 -out "$OUT/terrain-20"
holds terrain terrain-pins-hold
ls "$OUT"/terrain-20/*.md >/dev/null 2>&1 || fail "the terrain sweep wrote no report under $OUT/terrain-20"
cut="$(grep -hE '^\| `?pin-(route|cut)`? \| [1-9]' "$OUT"/terrain-20/*.md || true)"
[ -n "$cut" ] || fail "the terrain sweep refused no pin with pin-route or pin-cut"
say "the terrain sweep refused for a route or a cut: $(echo "$cut" | tr '\n' ' ')"

step seen go run ./cmd/harness seen -n 4 -out "$OUT/seen-4"
for v in 'condition 1' 'condition 2' 'cost' 'adopt'; do
  line="$(grep "^$v: " "$OUT/seen.log" || true)"
  [ -n "$line" ] || fail "the seen run printed no \"$v\" line"
  say "seen: $line"
done
say "holds: staging, the staged carrier and its guard, the xp allowance, moderation, terrain pins, the pre-MM12 world in the sim and the store, no draw moved, the house over HTTP, the Search run at 20, the terrain sweep at 20 and the seen record's verdict"
