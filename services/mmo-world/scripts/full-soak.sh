#!/usr/bin/env bash
# The full soak (MVP L358): every run the targets need and the headless
# soak with every system on, on one build (harness all -soak), beside the
# launch rehearsal on a kept local world (scripts/launch-rehearsal.sh).
# Several hours. It exits non-zero when a label exits non-zero or the
# rehearsal fails; a target that misses fails nothing, the report shows it.
#
#   BASE_ROOT=<a base checkout's services/mmo-world> scripts/full-soak.sh <out dir>
#   BASE=<base commit> scripts/full-soak.sh <out dir>
#
# <out>/runs holds the suite (suite.json, report.md, report.json and a dir
# per label), <out>/live the rehearsal, <out>/bin the harness build, and
# <out>/runs.log and <out>/live.log their logs. JOBS (3) is how many labels
# run at once; AGAINST an epoch file to read the report against (default
# the last epoch); the rehearsal takes its own PORT, PGPORT and KEEP.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."
OUT="${1:?usage: BASE_ROOT=<base services/mmo-world> scripts/full-soak.sh <out dir>}"
mkdir -p "$OUT/bin"
OUT="$(cd "$OUT" && pwd)"
[ -n "${BASE_ROOT:-}${BASE:-}" ] || {
  echo "full-soak: give BASE_ROOT (a base checkout's services/mmo-world) or BASE (a commit) for the rehearsal" >&2
  exit 2
}
export SPIKE_WORKERS="${SPIKE_WORKERS:-6}"
HARNESS="$OUT/bin/harness-$(git rev-parse --short=12 HEAD)-$(date +%s)"
go build -o "$HARNESS" ./cmd/harness
say() { echo "full-soak: $*"; }

suite_pid="" live_pid=""
cleanup() {
  for p in $suite_pid $live_pid; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM

set -- all -soak -jobs "${JOBS:-3}" -out "$OUT/runs"
if [ -n "${AGAINST:-}" ]; then set -- "$@" -against "$AGAINST"; fi
"$HARNESS" "$@" >"$OUT/runs.log" 2>&1 &
suite_pid=$!
HARNESS="$HARNESS" bash scripts/launch-rehearsal.sh "$OUT/live" >"$OUT/live.log" 2>&1 &
live_pid=$!
say "the suite ($OUT/runs.log) and the rehearsal ($OUT/live.log) started"

suite=0 live=0
wait "$suite_pid" || suite=$?
say "the suite exited $suite"
wait "$live_pid" || live=$?
say "the rehearsal exited $live"
suite_pid="" live_pid=""
[ -f "$OUT/runs/report.md" ] && say "report: $OUT/runs/report.md"
if [ -f "$OUT/runs/suite.json" ]; then
  failed="$(jq -r '[.labels[] | select(.exit != 0) | .label] | join(", ")' "$OUT/runs/suite.json")"
  [ -z "$failed" ] || say "labels that did not exit 0: $failed"
fi
tail -1 "$OUT/live.log"
[ "$suite" = 0 ] && [ "$live" = 0 ]
