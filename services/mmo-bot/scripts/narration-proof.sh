#!/usr/bin/env bash
# The narration proof: every narration check in one run.
#
#   scripts/narration-proof.sh <out>
#
# Each step's output goes to <out>/step-N.log and one line per step is
# printed. Every step runs with MMO_NARRATION unset, so nothing here can
# reach a model; the exit is non-zero if any step failed.
set -u

if [ $# -ne 1 ]; then
  echo "usage: scripts/narration-proof.sh <out>" >&2
  exit 2
fi

unset MMO_NARRATION ANTHROPIC_API_KEY
bot="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$1"
out="$(cd "$1" && pwd)"
failed=0

step() {
  local n="$1" name="$2" dir="$3"
  shift 3
  local log="$out/step-$n.log" start=$SECONDS
  if (cd "$dir" && "$@") >"$log" 2>&1; then
    echo "ok   $n $name ($((SECONDS - start)) s)"
  else
    echo "FAIL $n $name ($((SECONDS - start)) s), see $log"
    failed=1
  fi
}

step 1 "bot narration tests" "$bot" \
  bun test test/narration-proof.test.ts test/narration-cost.test.ts test/narration-story.test.ts \
  test/voice.test.ts test/naming.test.ts test/pool.test.ts test/media.test.ts
step 2 "stub cost figure" "$bot" \
  bun run scripts/narration-cost.ts --stub --out "$out/cost"
step 3 "world narration and media tests" "$bot/../mmo-world" \
  go test ./sim/game ./service ./render ./harness \
  -run 'KindName|Dossier|Narration|ArcKit|Portrait|Art|Banner|Chart|MediaKey|Proposals|APIMatchesRules' \
  -count=1 -timeout 40m
step 4 "mmo-narrate tests" "$bot/../../packages/mmo-narrate" \
  vp test run

if [ "$failed" -ne 0 ]; then
  echo "narration proof: FAILED"
  exit 1
fi
echo "narration proof: ok"
