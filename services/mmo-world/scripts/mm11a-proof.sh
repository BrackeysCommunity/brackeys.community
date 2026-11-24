#!/bin/sh
# Proves theft and alignment (GDD 4.5, 5.10, 18.3): alignment's depth
# rule, a scripted thief from its first burglary to the syndicate's grudge,
# a world saved before MM11a reopening unremarked with no earlier draw
# moved (in the sim and through the store), and the Crime run at 10
# players, which must show theft-never-mints and coin-drift holding with a
# clean audit.
#
#   sh scripts/mm11a-proof.sh <out dir>
#
# The store test needs Postgres as the store tests find it. The Crime run
# uses SPIKE_WORKERS (6 unless set). Every step's output is kept in the
# out dir; the script exits non-zero on the first failure.
set -eu
export LC_ALL=C
cd "$(dirname "$0")/.."
OUT="${1:?usage: sh scripts/mm11a-proof.sh <out dir>}"
mkdir -p "$OUT"
SPIKE_WORKERS="${SPIKE_WORKERS:-6}"
export SPIKE_WORKERS

say() { echo "mm11a-proof: $*"; }
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

step sim go test ./sim/align ./sim/game \
  -run 'TestAlignmentDepth|TestScriptedThief|TestPreMM11aWorldLoads|TestNoDrawMoved' -count=1 -timeout 40m -v
for t in TestAlignmentDepth TestScriptedThief TestPreMM11aWorldLoads TestNoDrawMoved; do
  grep -q "^--- PASS: $t " "$OUT/sim.log" || fail "$t did not run and pass"
done
step store go test ./store -run 'TestPreMM11aWorldLoads' -count=1 -v
grep -q '^--- PASS: TestPreMM11aWorldLoads ' "$OUT/store.log" || fail "the store's TestPreMM11aWorldLoads did not run and pass"

step crime go run ./cmd/harness crime -n 10 -out "$OUT/crime-10"

# holds <target id> requires the report row of that target to read yes.
holds() {
  text="$(jq -r --arg id "$1" '.rows[] | select(.id == $id) | .text' sheets/meta/targets.json)"
  [ -n "$text" ] || fail "no target $1 in meta.targets"
  row="$(grep -F "| $text |" "$OUT/crime.log" || true)"
  [ -n "$row" ] || fail "the Crime run reports no row for $1"
  case "$row" in
  *"| yes |") say "$1 holds: $(echo "$row" | awk -F' [|] ' '{print $(NF-1)}')" ;;
  *) fail "$1 does not hold: $row" ;;
  esac
}
holds theft-never-mints
holds coin-drift

ls "$OUT"/crime-10/*.md >/dev/null 2>&1 || fail "the Crime run wrote no report under $OUT/crime-10"
if grep -l 'discrepanc' "$OUT"/crime-10/*.md "$OUT/crime.log" >/dev/null 2>&1; then
  fail "the Crime run's audit found discrepancies: $(grep -h 'discrepanc' "$OUT"/crime-10/*.md "$OUT/crime.log" | head -3)"
fi
grep -q 'clean' "$OUT"/crime-10/*.md || fail "the Crime run's report shows no clean audit"
say "the Crime run's audit is clean"
say "holds: alignment's depth, the scripted thief, the pre-MM11a world in the sim and the store, no draw moved, and the Crime run at 10"
