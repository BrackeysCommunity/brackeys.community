#!/bin/sh
# Proves launch readiness on local worlds (GDD 14.9, 18.5, 19).
#
#   sh scripts/mm14-proof.sh <out dir>
#
# In order, each step's output in <out>/<step>.log:
#   tests        the Go and bot tests the steps rest on
#   build        the base (a throwaway worktree of BASE) and this tree's
#                binaries, the next book and an unloadable one
#   reopen       a world the base build played reopens on this build with
#                MMO_SHEETS_FROM, unchanged; an unloadable pending book
#                fails the open
#   two-servers  a kept world on the manual clock with the next book and
#                MMO_ROLL_EPOCH_NEXT=1: the bot's two-servers run through
#                season zero's close and season one's first day; the epoch
#                taken once at the close, its notes, the made kind and the
#                drawn tiles unchanged, one player forgotten by /forget-me
#   restore      backup.sh, DROP SCHEMA mmo, restore.sh and op verify; the
#                world reopens at the same tick and digest and plays on
#   forget       another player forgotten by POST /v1/forget with the
#                forget token: tombstones, the ledger, other characters
#                untouched, op replay over the day
#   export       op export holds no Discord id, token, key or raw id
#   load         2 minutes at ten times the closed test's peak on a fresh
#                disposable world at 3-second ticks
#   report       harness all -only check,season,social,economy-10,social-alone
#                against epoch 0001 (the NPC cost row is read alone)
#
# It runs its own Postgres (TCP only) and Redis under the out dir, on
# PGPORT (15440) and REDISPORT (16390), and its worlds one at a time on
# PORT (18081). SPIKE_WORKERS is 6 unless set. The world's secrets are
# generated into <out>/secrets (mode 600) and never printed. Everything it
# started is stopped on exit, and Postgres, the binaries, the secrets and
# the base worktree removed unless KEEP=1; logs and outputs stay. It exits
# non-zero on the first failure.
set -eu
export LC_ALL=C
CALLER=$PWD
cd "$(dirname "$0")/.."
HERE=$PWD
OUT="${1:?usage: sh scripts/mm14-proof.sh <out dir>}"
case "$OUT" in /*) ;; *) OUT="$CALLER/$OUT" ;; esac
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
SPIKE_WORKERS="${SPIKE_WORKERS:-6}"
export SPIKE_WORKERS
PORT="${PORT:-18081}"
PGPORT="${PGPORT:-15440}"
REDISPORT="${REDISPORT:-16390}"
URL="http://localhost:$PORT"
PGBIN="$(dirname "$(readlink -f "$(command -v postgres)")")"
BIN="$OUT/bin"
SECRETS="$OUT/secrets"
STAMP="$(git rev-parse --short=12 HEAD)-$(date +%s)"
WORLD="$BIN/world-$STAMP"
BASE_WORLD="$BIN/world-base-$STAMP"
OP="$BIN/op-$STAMP"
HARNESS="$BIN/harness-$STAMP"
NEXT="$OUT/next"
BROKEN="$OUT/broken"

# The closed test's build: the live map's finished commit.
BASE=d65454b075b8fa00e73c4f55a75f00fe059be4da
EPOCH0001=harness/epochs/0001-1767b7ef4195.json
TICKS_PER_DAY=144
REOPEN_TICKS=20
PLAY_ON=10
TWO_SERVERS_CAP=1500
LOAD_CAP=480
REPORT_CAP=1800

. "$HERE/scripts/mm14/lib.sh"

# The proof sets every switch its worlds and runs read; none comes from
# the caller's shell.
unset DATABASE_URL MMO_URL MMO_API_TOKEN MMO_OPERATOR_TOKEN MMO_MAP_TOKEN MMO_FORGET_TOKEN MMO_MASTER_SECRET \
  MMO_SHEETS_ROOT MMO_SHEETS_FROM MMO_SHEETS_NEXT MMO_ROLL_EPOCH MMO_ROLL_EPOCH_NEXT MMO_MANUAL_CLOCK MMO_DISPOSABLE \
  MMO_WORLD_ID MMO_KEY_VERSION MMO_TICK_SECONDS MMO_COMMIT REDIS_URL LOAD_URL LOAD_PPM LOAD_MINUTES LOAD_SERVERS LOAD_RAMP \
  ECONOMY_SEED ECONOMY_STAGING SEARCH_ONLY 2>/dev/null || true

# clear <pattern...> removes what the patterns match inside the out dir,
# named relative to it; quote a pattern so it expands there.
clear() {
  (
    cd "${OUT:?}"
    for p in "$@"; do
      for f in $p; do
        if [ -e "$f" ]; then rm -rf -- "$f"; fi
      done
    done
  )
}

cleanup() {
  stop_pid "$OUT/run/posters.pid"
  stop_world
  stop_pid "$OUT/run/redis.pid"
  "$PGBIN/pg_ctl" -D "$OUT/pg" stop -m fast >/dev/null 2>&1 || true
  if [ -e "$OUT/base" ]; then git worktree remove --force "$OUT/base" >/dev/null 2>&1 || true; fi
  if [ "${KEEP:-0}" != 1 ]; then
    clear pg bin secrets base run next broken 'backup/*.dump'
  fi
}
trap cleanup EXIT
trap 'exit 1' INT TERM

for p in "$OUT/run/world.pid" "$OUT/run/redis.pid"; do
  if [ -f "$p" ] && kill -0 "$(cat "$p")" 2>/dev/null; then
    echo "mm14-proof: a run from $OUT is still going (pid $(cat "$p")): stop it first" >&2
    trap - EXIT
    exit 1
  fi
done
if [ -e "$OUT/base" ]; then git worktree remove --force "$OUT/base" >/dev/null 2>&1 || clear base; fi
clear state run pg bin secrets next broken backup export load report '*.log' '*.json' '*.jsonl' '*.txt' '*.out' '*.err'
mkdir -p "$OUT/state" "$OUT/run" "$BIN"

# step <name> <command...> runs a command (a function here or a program)
# with -e in a subshell, its output in <out>/<name>.log and its notes on
# the console.
step() {
  name=$1
  shift
  say "$name"
  set +e
  (
    set -e
    "$@"
  ) 3>&1 >"$OUT/$name.log" 2>&1
  rc=$?
  set -e
  if [ "$rc" != 0 ]; then
    tail -40 "$OUT/$name.log"
    say "FAIL: $name (see $OUT/$name.log)"
    exit 1
  fi
}

# passed <log> <test...> requires each Go test to have run and passed.
passed() {
  for t in $(echo "$2" | tr '|' ' '); do
    grep -q "^--- PASS: $t " "$OUT/$1.log" || fail "$t did not run and pass (see $OUT/$1.log)"
  done
}

# gotest <package> <tests> runs exactly those tests, verbose, into
# <out>/tests-go.log.
gotest() {
  say "go test $1"
  go test "$1" -run "^($2)\$" -count=1 -timeout 40m -v >>"$OUT/tests-go.log" 2>&1 || fail "go test $1 failed (see $OUT/tests-go.log)"
  passed tests-go "$2"
}

tests() {
  : >"$OUT/tests-go.log"
  gotest ./export 'TestStored|TestExportHoldsNoIdentity|TestExportFields'
  gotest ./sheetdiff 'TestDiff|TestEverySheetClassified|TestSameBookNoChange|TestHiddenClassAbility'
  gotest ./store 'TestRestampEpoch|TestEpochNotesUpsert|TestForgetIdentity|TestForgetThroughTheRules|TestMatchesRefusesOtherEpoch'
  gotest ./service 'TestSeasonEpoch|TestRollEpoch|TestEpochRestartMidway|TestUnloadablePendingBook|TestOtherEpochRefused|TestNextRollFromEnv|TestForgetRoute|TestActForget|TestLocalForgetFreesTheUser|TestStoredReplyKeepsSeen|TestTickRingWraps|TestTicksEndpoint|TestTokenLists|TestTokens'
  gotest ./sim/game 'TestForgetRefusesAndMarks|TestForgetSweep|TestForgetWaitsInAFight|TestForgetWaitsOnTheRoad|TestForgetNamesATraveller|TestForgetAtTickZero|TestForgetReplays|TestSeasonEpochAtTheBoundary|TestSeasonEpochStepsTheRoll|TestNoDrawMoved|TestReplayFromSnapshot|TestReplayMM8|TestReplayMM8a|TestReplayMM9|TestReplayMM10'
  gotest ./sim/world 'TestReplayFixtures|TestReplayDigest'
  gotest ./cmd/op 'TestBackupRestore|TestVerifyFromEpoch|TestOpForget|TestExportCommand|TestOpReplayInsideOneEpoch'
  gotest ./harness 'TestReadingsParseReport|TestEpochLast|TestEpochReportDiffChange|TestEpochFilesCommitted'
  gotest ./cmd/harness 'TestReportCheck|TestReportInWriteStrict|TestAllCheckSeason'
  ! grep -q -- '--- SKIP' "$OUT/tests-go.log" || fail "a test skipped: $(grep -- '--- SKIP' "$OUT/tests-go.log" | head -3)"
  (cd ../mmo-bot && bun test test/forget.test.ts test/cards.test.ts) >"$OUT/tests-bot.log" 2>&1 || {
    tail -20 "$OUT/tests-bot.log"
    fail "bun test failed (see $OUT/tests-bot.log)"
  }
  grep -Eq '^ *[1-9][0-9]* pass' "$OUT/tests-bot.log" && grep -Eq '^ *0 fail' "$OUT/tests-bot.log" ||
    fail "the bot's tests did not all pass (see $OUT/tests-bot.log)"
  note "Go tests: $(grep -c '^--- PASS' "$OUT/tests-go.log") named tests pass, none skipped; bot: $(grep -E '^ *[0-9]+ pass' "$OUT/tests-bot.log" | sed 's/^ *//')"
}

build() {
  git worktree add --detach "$OUT/base" "$BASE"
  (cd "$OUT/base/services/mmo-world" && go build -o "$BASE_WORLD" ./cmd/world)
  go build -o "$WORLD" ./cmd/world
  go build -o "$OP" ./cmd/op
  go build -o "$HARNESS" ./cmd/harness
  mkdir -p "$BIN/path"
  ln -s "$OP" "$BIN/path/op"
  sh scripts/mm14/next-book.sh "$HERE" "$NEXT"
  sh scripts/mm14/next-book.sh -broken "$HERE" "$BROKEN"
  d=$(cd "$OUT/base/services/mmo-world" && "$HARNESS" digest)
  put base-book "$d"
  d=$("$HARNESS" digest)
  put book "$d"
  d=$(cd "$NEXT" && "$HARNESS" digest)
  put next-book "$d"
  [ "$(got base-book)" != "$(got book)" ] || fail "the base book and this tree's are the same"
  [ "$(got next-book)" != "$(got book)" ] || fail "the next book is this tree's book"
  note "books: base $(got base-book | cut -c1-12), this tree $(got book | cut -c1-12), next $(got next-book | cut -c1-12)"

  (umask 077 && mkdir -p "$SECRETS")
  (
    umask 077
    head -c 32 /dev/urandom | base64 >"$SECRETS/master"
    for t in api-token operator-token forget-token; do head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' >"$SECRETS/$t"; done
    for t in api operator forget; do printf 'Authorization: Bearer %s\n' "$(cat "$SECRETS/$t-token")" >"$SECRETS/h-$t"; done
    printf 'Authorization: Bearer not-a-token\n' >"$SECRETS/h-wrong"
  )

  "$PGBIN/initdb" -D "$OUT/pg" -U postgres -A trust >/dev/null
  printf "port = %s\nunix_socket_directories = ''\nlisten_addresses = 'localhost'\n" "$PGPORT" >>"$OUT/pg/postgresql.conf"
  "$PGBIN/pg_ctl" -D "$OUT/pg" -l "$OUT/pg.log" -w start >/dev/null
  redis-server --port "$REDISPORT" --bind 127.0.0.1 --save "" --appendonly no --dir "$OUT/run" \
    --daemonize yes --pidfile "$OUT/run/redis.pid" >/dev/null
  for _ in $(seq 1 20); do
    redis-cli -p "$REDISPORT" ping 2>/dev/null | grep -q PONG && break
    sleep 0.5
  done
  redis-cli -p "$REDISPORT" ping | grep -q PONG || fail "Redis did not start on :$REDISPORT"
  note "Postgres $("$PGBIN/postgres" --version | awk '{print $3}') on :$PGPORT and Redis on :$REDISPORT under $OUT"
}

# A world saved at the base reopens unchanged on this build.
reopen() {
  db=reopen
  wid=w-mm14-reopen
  new_db $db
  migrate $db "$OUT/base/services/mmo-world"
  start_world reopen-world "$BASE_WORLD" "$OUT/base/services/mmo-world" $db $wid MMO_MANUAL_CLOCK=1
  a=$(create mm14-proof-reopen-a)
  b=$(create mm14-proof-reopen-b)
  dir=$(call api GET "/v1/options?characterId=$b" | jq -r '[.moves[] | select(.open)][0].dir // empty')
  [ -n "$dir" ] || fail "$b has no open step"
  field="\"dir\":$dir"
  answer=$(press "$b" step "$field")
  [ "$answer" = ok ] || fail "$b's step was refused $answer"
  say "at $BASE: $(play $REOPEN_TICKS "$a" "$b")"
  opc digest >"$OUT/reopen-stop.json"
  stopped=$(jq -c '{tick, digest}' "$OUT/reopen-stop.json")
  [ "$(jq -r '.tick' "$OUT/reopen-stop.json")" -ge "$REOPEN_TICKS" ] || fail "the base world played only to $stopped"
  stop_world
  ! grep -q 'SHEETS RESTAMPED' "$OUT/reopen-world.log" || fail "the base build re-stamped its own world"
  founded=$(grep -c '"world founded"' "$OUT/reopen-world.log")
  [ "$(sql $db "select sheets_digest from mmo.world where id = '$wid'")" = "$(got base-book)" ] ||
    fail "the base world is not stamped with the base book"

  (cd "$OUT/base/services/mmo-world" && grep -o '\.\./\.\./drizzle/[^ ]*migration.sql' sqlc.yaml | sort) >"$OUT/state/base-migrations"
  grep -o '\.\./\.\./drizzle/[^ ]*migration.sql' sqlc.yaml | sort >"$OUT/state/migrations"
  added=$(comm -13 "$OUT/state/base-migrations" "$OUT/state/migrations")
  [ -n "$added" ] || fail "this tree adds no migration to the base's"
  # shellcheck disable=SC2086
  migrate $db "$HERE" $added
  start_world reopen-world "$WORLD" "$HERE" $db $wid MMO_MANUAL_CLOCK=1 MMO_SHEETS_FROM="$(got base-book)"
  [ "$(grep -c 'SHEETS RESTAMPED' "$OUT/reopen-world.log")" = 1 ] || fail "SHEETS RESTAMPED was not logged once"
  ! grep -q 'SHEETS CHANGED' "$OUT/reopen-world.log" || fail "the world was wiped instead of kept"
  [ "$(grep -c '"world founded"' "$OUT/reopen-world.log")" = "$founded" ] || fail "the world was founded again"
  opened=$(opc digest | jq -c '{tick, digest}')
  [ "$opened" = "$stopped" ] || fail "the world opened at $opened, stopped at $stopped"
  note "reopen: the base build played to $stopped; this build re-stamped it once and opened at the same tick and digest"
  say "on this build: $(play $PLAY_ON "$a" "$b")"
  audit_clean reopen-audit
  last=$(opc digest | jq -c '{tick, digest}')
  stop_world

  start_world reopen-world "$WORLD" "$HERE" $db $wid MMO_MANUAL_CLOCK=1
  [ "$(grep -c 'SHEETS RESTAMPED' "$OUT/reopen-world.log")" = 1 ] || fail "a second open re-stamped again"
  [ "$(opc digest | jq -c '{tick, digest}')" = "$last" ] || fail "a second open moved the world from $last"
  stop_world

  ticks=$(sql $db "select count(*) || ' ' || max(tick) from mmo.tick where world_id = '$wid'")
  refused_open reopen-broken "$WORLD" "$HERE" $db $wid MMO_MANUAL_CLOCK=1 MMO_SHEETS_NEXT="$BROKEN"
  grep -q 'MMO_SHEETS_NEXT' "$OUT/reopen-broken.log" && grep -q 'weather-turn' "$OUT/reopen-broken.log" ||
    fail "the refused open does not name MMO_SHEETS_NEXT and weather-turn: $(tail -2 "$OUT/reopen-broken.log" | cut -c1-300)"
  [ "$(sql $db "select count(*) || ' ' || max(tick) from mmo.tick where world_id = '$wid'")" = "$ticks" ] ||
    fail "the refused open wrote ticks"
  [ "$(sql $db "select sheets_digest from mmo.world where id = '$wid'")" = "$(got book)" ] || fail "the refused open re-stamped the world"
  note "an unloadable pending book fails the open before any tick: $(grep -o 'MMO_SHEETS_NEXT[^"]*' "$OUT/reopen-broken.log" | head -1 | cut -c1-160)"

  to=$(echo "$last" | jq -r '.tick')
  opd $db $wid "$HERE" 0 replay -from 0 -to "$to" >"$OUT/reopen-replay.json"
  replayed "$OUT/reopen-replay.json"
  [ "$(jq -r '.digest' "$OUT/reopen-replay.json")" = "$(echo "$last" | jq -r '.digest')" ] || fail "op replay ended on another digest"
  note "op replay 0..$to on this build: $(jq -c '{checked, ticks, actions}' "$OUT/reopen-replay.json"); audit clean"
}

# The tiles around the origin, drawn baseline and scaffold, through op.
tiles() {
  for q in -2 -1 0 1 2; do
    for r in -2 -1 0 1 2; do
      s=$((q + r))
      [ "$s" -ge -2 ] && [ "$s" -le 2 ] || continue
      opc inspect tile "$q" "$r" | jq -c --argjson q "$q" --argjson r "$r" '{q: $q, r: $r, baseline, scaffold}'
    done
  done
}

# Two servers through season zero's close and season one's first world
# day, the epoch taken at the boundary, and a /forget-me.
two_servers() {
  db=kept
  wid=w-mm14
  put kept-world $wid
  new_db $db
  migrate $db "$HERE"
  start_world kept-world "$WORLD" "$HERE" $db $wid MMO_MANUAL_CLOCK=1 MMO_SHEETS_NEXT="$NEXT" MMO_ROLL_EPOCH_NEXT=1 \
    MMO_FORGET_TOKEN="$(secret forget-token)"
  grep '"world founded"' "$OUT/kept-world.log" | grep -q '"disposable":false' || fail "the world was not founded kept"
  tiles >"$OUT/tiles-before.jsonl"
  [ "$(wc -l <"$OUT/tiles-before.jsonl")" -eq 19 ] || fail "read $(wc -l <"$OUT/tiles-before.jsonl") tiles, not 19"

  (
    cd ../mmo-bot
    MMO_API_TOKEN="$(secret api-token)" MMO_OPERATOR_TOKEN="$(secret operator-token)" REDIS_URL="redis://127.0.0.1:$REDISPORT" \
      bun run src/scripted.ts --two-servers "$URL" >"$OUT/two-servers.out" 2>"$OUT/two-servers.err" &
    pid=$!
    echo "$pid" >"$OUT/run/posters.pid"
    (sleep "$TWO_SERVERS_CAP" && kill "$pid" 2>/dev/null) &
    w=$!
    rc=0
    wait "$pid" || rc=$?
    kill "$w" 2>/dev/null || true
    wait "$w" 2>/dev/null || true
    rm -f "$OUT/run/posters.pid"
    exit "$rc"
  ) || fail "the two-servers run exited non-zero: $(tail -1 "$OUT/two-servers.out" | cut -c1-400)"
  sum="$OUT/two-servers.json"
  tail -1 "$OUT/two-servers.out" >"$sum"
  jq -e '.mode == "two-servers" and .ok and (.misses | length == 0) and (.problems | length == 0) and (.audit | length == 0)' "$sum" >/dev/null ||
    fail "the two-servers run did not hold: $(jq -c '{ok, misses, problems}' "$sum" | cut -c1-400)"
  jq -e '.servers | length == 2 and .[0].guild != .[1].guild and .[0].settlement != .[1].settlement and .[0].settings != .[1].settings' "$sum" >/dev/null ||
    fail "the two servers are not apart: $(jq -c '[.servers[] | {server, guild, settlement}]' "$sum")"
  jq -e '[.posted[] | (.promotions["season.epoch 1"] == 1 and .events["season.began 1"] == 1)] | length == 2 and all' "$sum" >/dev/null ||
    fail "a server did not post the epoch card and season one's start once each: $(jq -c '.posted' "$sum" | cut -c1-400)"
  jq -e '.refused.code == "house-scope" and (.refused.wrote | not)' "$sum" >/dev/null || fail "B's staff were not refused on A's stage"
  jq -e '.season.n == 1 and .season.to >= .season.began + 144' "$sum" >/dev/null || fail "the clock did not run through season one's first day"
  closes=$(jq -r '.season.closes' "$sum")
  put closes "$closes"
  note "two servers: $(jq -r '[.servers[] | "\(.guild) at \(.place) (settlement \(.settlement))"] | join(" and ")'  "$sum"); $(jq -r '.presses' "$sum") presses, no card problem, B's staff refused house-scope on A's stage"
  note "season zero closed at tick $closes; season one began at $(jq -r '.season.began' "$sum") and the clock ran to $(jq -r '.season.to' "$sum"); each server posted the epoch card and season one's start once"

  [ "$(grep -c 'EPOCH TAKEN' "$OUT/kept-world.log")" = 1 ] || fail "EPOCH TAKEN logged $(grep -c 'EPOCH TAKEN' "$OUT/kept-world.log") times, not once"
  grep 'EPOCH TAKEN' "$OUT/kept-world.log" | grep -q 'MMO_ROLL_EPOCH=1' || fail "EPOCH TAKEN does not name MMO_ROLL_EPOCH=1"
  facts=$(sql $db "select count(*) || ' ' || coalesce(min(tick), -1) from mmo.fact where world_id = '$wid' and kind = 'season.epoch'")
  [ "${facts% *}" = 1 ] || fail "${facts% *} season.epoch facts, not 1"
  [ "${facts#* }" -ge "$closes" ] || fail "the epoch was taken at tick ${facts#* }, before the close at $closes"
  [ "$(sql $db "select sheets_digest || ' ' || rules_epoch from mmo.world where id = '$wid'")" = "$(got next-book) 1" ] ||
    fail "the world is stamped $(sql $db "select sheets_digest || ' ' || rules_epoch from mmo.world where id = '$wid'")"
  sql $db "select json_build_object('from', from_digest, 'to', to_digest, 'rollFrom', roll_from, 'rollTo', roll_to, 'notes', notes) from mmo.epoch_note where world_id = '$wid'" >"$OUT/epoch-notes.json"
  [ "$(wc -l <"$OUT/epoch-notes.json")" -eq 1 ] || fail "$(wc -l <"$OUT/epoch-notes.json") stored epoch notes, not 1"
  jq -e --arg from "$(got book)" --arg to "$(got next-book)" '
    .from == $from and .to == $to and .rollFrom == 0 and .rollTo == 1 and .notes.season == 1 and .notes.unseen == 1 and
    (.notes.seen | length == 1) and (.notes.seen[0] | .sheet == "items.materials" and .row == "bog-iron" and
      .column == "vector.edge" and .change == "changed" and .before == "24" and .after == "25" and (.unit // "") != "")' \
    "$OUT/epoch-notes.json" >/dev/null || fail "the stored notes are not one seen change and one unseen: $(jq -c . "$OUT/epoch-notes.json" | cut -c1-400)"
  note "the epoch: taken once at tick ${facts#* } (the close $closes), rules_epoch 0 to 1, notes $(jq -c '.notes.seen[0] | {sheet, row, column, before, after, unit}' "$OUT/epoch-notes.json") and 1 unseen"

  sql $db "select body->'kinds' from mmo.snapshot where world_id = '$wid' and tick = (select max(tick) from mmo.snapshot where world_id = '$wid' and tick < $closes)" >"$OUT/kinds-before.json"
  sql $db "select body->'kinds' from mmo.snapshot where world_id = '$wid' and tick = (select max(tick) from mmo.snapshot where world_id = '$wid')" >"$OUT/kinds-after.json"
  kind=$(jq -r '.crafted.kind' "$sum")
  jq -e --slurpfile after "$OUT/kinds-after.json" '
    (.list | length) > 0 and
    ([.list[] | . as $k | ($after[0].list[] | select(.id == $k.id))] == .list)' "$OUT/kinds-before.json" >/dev/null ||
    fail "a kind made before the epoch reads differently after it"
  item=$(jq -r '.crafted.item' "$sum")
  [ -n "$item" ] || fail "the crafter made no item"
  for when in before after; do
    if [ $when = before ]; then at="< $closes"; else at="<= (select max(tick) from mmo.snapshot where world_id = '$wid')"; fi
    sql $db "select body from mmo.snapshot where world_id = '$wid' and tick = (select max(tick) from mmo.snapshot where world_id = '$wid' and tick $at)" |
      jq -c --arg id "$item" '[.chars[] | .. | objects | select(.id? == $id)][0]' >"$OUT/item-$when.json"
  done
  [ "$(cat "$OUT/item-before.json")" != null ] && cmp -s "$OUT/item-before.json" "$OUT/item-after.json" ||
    fail "the crafted item reads differently after the epoch: $(cut -c1-200 "$OUT/item-before.json") then $(cut -c1-200 "$OUT/item-after.json")"
  tiles >"$OUT/tiles-after.jsonl"
  cmp -s "$OUT/tiles-before.jsonl" "$OUT/tiles-after.jsonl" || fail "a drawn tile reads differently after the epoch"
  note "after the epoch: the $(jq '.list | length' "$OUT/kinds-before.json") kinds made before it (the crafter's $kind) and its item read the same, and the 19 tiles around the origin draw the same"

  user=$(jq -r '.forget.user' "$sum")
  put forget-me-user "$user"
  put forget-me-char "$(jq -r '.forget.character' "$sum")"
  jq -e '.forget.lookup == "" and .forget.purged > 0 and (.forget.left | length == 0) and .forget.othersKept' "$sum" >/dev/null ||
    fail "/forget-me left something: $(jq -c '.forget' "$sum")"
  [ -z "$(redis-cli -p "$REDISPORT" --scan --pattern "*$user*")" ] || fail "Redis still holds keys of the forgotten user"
  note "/forget-me: $(jq -r '.forget.character' "$sum") forgotten, $(jq -r '.forget.purged' "$sum") of the bot's Redis keys removed, none left, another user's kept"
  audit_clean two-servers-audit
}

# The restore drill.
restore() {
  db=kept
  wid=$(got kept-world)
  opc digest | jq -c '{tick, digest}' >"$OUT/state/drill-digest"
  d=$(cat "$OUT/state/drill-digest")
  mkdir -p "$OUT/backup"
  dump=$(PATH="$BIN/path:$PGBIN:$PATH" DATABASE_URL="$(db_url $db)" MMO_WORLD_ID=$wid sh scripts/backup.sh "$OUT/backup")
  [ -f "$dump" ] && [ -f "${dump%.dump}.manifest.json" ] || fail "backup.sh wrote no dump and manifest"
  jq -e --argjson d "$d" '.tick == $d.tick and .digest == $d.digest' "${dump%.dump}.manifest.json" >/dev/null ||
    fail "the manifest names $(jq -c '{tick, digest}' "${dump%.dump}.manifest.json"), not $d"
  stop_world
  sql $db "DROP SCHEMA mmo CASCADE"
  [ "$(sql $db "select to_regclass('mmo.world') is null")" = t ] || fail "the schema was not dropped"
  (
    export PATH="$BIN/path:$PGBIN:$PATH" DATABASE_URL="$(db_url $db)" MMO_WORLD_ID=$wid MMO_KEY_VERSION=1 MMO_ROLL_EPOCH=1 MMO_SHEETS_ROOT="$NEXT"
    MMO_MASTER_SECRET="$(secret master)"
    export MMO_MASTER_SECRET
    sh scripts/restore.sh "$dump" >"$OUT/restore-verify.json"
  ) || fail "restore.sh failed"
  jq -e --argjson d "$d" '.manifest.tick == $d.tick and .manifest.digest == $d.digest and .replay.checked == .replay.ticks and .replay.ticks > 0' \
    "$OUT/restore-verify.json" >/dev/null || fail "op verify: $(jq -c '{manifest, replay}' "$OUT/restore-verify.json" | cut -c1-300)"
  note "restore: dumped at $d, dropped the mmo schema, restored; op verify replayed $(jq -c '.replay | {from, to, checked}' "$OUT/restore-verify.json")"
  start_world kept-world "$WORLD" "$HERE" $db $wid MMO_MANUAL_CLOCK=1 MMO_SHEETS_ROOT="$NEXT" MMO_ROLL_EPOCH=1 \
    MMO_FORGET_TOKEN="$(secret forget-token)"
  [ "$(opc digest | jq -c '{tick, digest}')" = "$d" ] || fail "the restored world opened at $(opc digest | jq -c '{tick, digest}'), not $d"
  audit_clean restore-audit
  sum="$OUT/two-servers.json"
  played=$(play $PLAY_ON $(jq -r '[.servers[0].characters.players[0], "walk:" + .servers[0].characters.players[2], .servers[1].characters.players[0], .forget.character] | join(" ")' "$sum"))
  grep -q ' ok$' "$OUT/state/played" || fail "no press was accepted after the restore: $played"
  grep -q ' forgotten$' "$OUT/state/played" || fail "the forgotten character's presses were not refused forgotten: $played"
  audit_clean restore-audit-after
  note "the restored world opened at the same tick and digest with a clean audit, then played $PLAY_ON ticks ($played) and audits clean"
}

# The other characters' rows of the character table, but the one asked for.
rows() {
  sql kept "select id, discord_id, version, q, r, banned, body::text from mmo.character where world_id = '$(got kept-world)' and id <> '$1' order by id"
}

# A forget through POST /v1/forget with the forget token.
forget() {
  db=kept
  wid=$(got kept-world)
  sum="$OUT/two-servers.json"
  char=$(jq -r '.servers[0].characters.players[1]' "$sum")
  user=$(sql $db "select discord_id from mmo.character where world_id = '$wid' and id = '$char'")
  put forget-user "$user"
  put forget-char "$char"
  case "$user" in forgotten:* | '') fail "$char has no Discord id to forget" ;; esac
  [ "$(call api GET "/v1/player?discordId=$user" | jq -r '.characterId')" = "$char" ] || fail "the world does not find $char by its Discord id"

  clock_to $(($(tick) + 2))
  rows "$char" >"$OUT/forget-rows-0.txt"
  clock_to $(($(tick) + 2))
  rows "$char" >"$OUT/forget-rows-1.txt"
  cmp -s "$OUT/forget-rows-0.txt" "$OUT/forget-rows-1.txt" || fail "other characters' rows move on an idle tick, so the forget cannot be told from it"

  body="{\"interactionId\":\"$(next_id forget)\",\"discordId\":\"$user\"}"
  call forget POST /v1/forget "$body" >"$OUT/forget-reply.json"
  jq -e '.forgotten' "$OUT/forget-reply.json" >/dev/null || fail "POST /v1/forget: $(cat "$OUT/forget-reply.json")"
  call forget POST /v1/forget "$body" | cmp -s - "$OUT/forget-reply.json" || fail "a repeat of the forget answered differently"
  wrong="{\"interactionId\":\"$(next_id forget)\",\"discordId\":\"$user\"}"
  code=$(status wrong POST /v1/forget "$wrong")
  [ "$code" = 401 ] || fail "a wrong token was answered $code, not 401"
  act="{\"interactionId\":\"$(next_id rest)\",\"characterId\":\"$char\",\"version\":0,\"kind\":\"rest\"}"
  code=$(status forget POST /v1/actions "$act")
  [ "$code" = 401 ] || fail "the forget token was answered $code on /v1/actions, not 401"
  at=$(tick)
  clock_to $((at + 2))
  opc inspect character "$char" >"$OUT/forget-character.json"
  jq -e '.forgotten > 0 and .forget > 0' "$OUT/forget-character.json" >/dev/null || fail "$char was not swept: $(jq -c '{forget, forgotten}' "$OUT/forget-character.json")"
  rows "$char" >"$OUT/forget-rows-2.txt"
  cmp -s "$OUT/forget-rows-1.txt" "$OUT/forget-rows-2.txt" || fail "the forget moved another character's row"
  [ "$(call api GET "/v1/player?discordId=$user" | jq -r '.characterId // ""')" = "" ] || fail "the world still finds the forgotten player"
  note "POST /v1/forget with the forget token: $(jq -c . "$OUT/forget-reply.json") for $char, a repeat the same, a wrong token 401, the forget token 401 on /v1/actions; swept by tick $((at + 2)); every other character's row byte-identical"

  for who in "$char:$user" "$(got forget-me-char):$(got forget-me-user)"; do
    c=${who%%:*}
    u=${who#*:}
    [ "$(sql $db "select discord_id from mmo.character where world_id = '$wid' and id = '$c'")" = "forgotten:$c" ] || fail "$c has no tombstone"
    [ "$(sql $db "select count(*) from mmo.house_log where world_id = '$wid' and (discord_id = '$u' or (character_id = '$c' and discord_id <> ''))")" = 0 ] ||
      fail "the house log still names $c's Discord id"
    [ "$(sql $db "select count(*) from mmo.ledger_txn where world_id = '$wid' and key = 'forget-$c'")" = 1 ] || fail "no ledger transaction forget-$c"
    held=$(sql $db "select count(*) from (select e.asset from mmo.ledger_entry e where e.world_id = '$wid' and (e.account = 'char:$c' or e.account like 'char:$c/%') group by e.asset having sum(e.units) <> 0) x")
    [ "$held" = 0 ] || fail "$c's ledger accounts hold $held assets after its forget"
    odd=$(sql $db "select count(*) from mmo.ledger_entry e join mmo.ledger_txn t using (world_id, txn) where e.world_id = '$wid' and (t.key = 'forget-$c' or t.key like 'forget-$c/%') and not (e.account = 'char:$c' or e.account like 'char:$c/%' or e.account like 'pool:%' or e.account in ('sink:forgotten', 'sink:staged'))")
    [ "$odd" = 0 ] || fail "forget-$c moved holdings on $odd legs outside its own account, the pools and the forgotten and staged sinks"
    legs=$(sql $db "select string_agg(e.asset || ' ' || e.units || ' ' || e.account, ', ' order by e.leg) from mmo.ledger_entry e join mmo.ledger_txn t using (world_id, txn) where e.world_id = '$wid' and (t.key = 'forget-$c' or t.key like 'forget-$c/%')")
    note "$c: tombstone forgotten:$c, no house-log row with its Discord id, its accounts at zero; forget-$c moved $legs"
  done
  audit_clean forget-audit
  last=$(tick)
  stop_world
  from=$((at / TICKS_PER_DAY * TICKS_PER_DAY))
  opd $db $wid "$NEXT" 1 replay -from "$from" -to "$last" >"$OUT/forget-replay.json"
  replayed "$OUT/forget-replay.json"
  note "op audit clean; op replay over the world day of the forget $(jq -c '{from, to, checked, actions}' "$OUT/forget-replay.json")"
}

# The recorded-play export holds no identity, token or key.
export_() {
  db=kept
  wid=$(got kept-world)
  ex="$OUT/export"
  DATABASE_URL="$(db_url $db)" MMO_WORLD_ID=$wid MMO_SHEETS_ROOT="$NEXT" "$OP" export -out "$ex" >"$OUT/export-reply.json"
  jq -e . "$ex/manifest.json" >/dev/null || fail "the manifest does not parse"
  for f in "$ex"/*.jsonl; do
    jq -c . "$f" >/dev/null || fail "$(basename "$f") does not parse"
  done
  jq -e '.records["days.jsonl"] > 0 and .records["world.jsonl"] > 0' "$ex/manifest.json" >/dev/null ||
    fail "the export holds no days or world days: $(jq -c '.records' "$ex/manifest.json")"

  needles="$SECRETS/needles"
  (
    umask 077
    for t in master api-token operator-token forget-token; do secret $t; done
    base64 -d <"$SECRETS/master" | od -An -tx1 | tr -d ' \n'
    echo
    echo "$wid"
    got forget-user
    got forget-me-user
    grep -oE '[0-9]{17,20}' "$OUT/two-servers.out" | sort -u
  ) | grep -v '^$' >"$needles"
  hits=$(grep -rlFf "$needles" "$ex" | wc -l | tr -d ' ')
  [ "$hits" = 0 ] || fail "$hits export files hold a token, the master, the world id or a Discord, server, channel or role id"
  hits=$(grep -rlE '"c-[0-9]{1,15}"|(^|[^0-9])[0-9]{17,20}([^0-9]|$)|two-servers-|mm14-proof-|forgotten:' "$ex" | wc -l | tr -d ' ')
  [ "$hits" = 0 ] || fail "$hits export files hold a raw character id, a run of 17 to 20 digits or an interaction id"
  note "export: $(jq -c '.records' "$ex/manifest.json"); every file parses; none of $(wc -l <"$needles" | tr -d ' ') ids, tokens and keys, no raw character id, no 17-20 digit run, no interaction id"
}

# Ten times the closed test's peak on a fresh disposable world.
load() {
  db=load
  wid=w-mm14-load
  new_db $db
  migrate $db "$HERE"
  start_world load-world "$WORLD" "$HERE" $db $wid MMO_DISPOSABLE=1 MMO_TICK_SECONDS=3
  rc=0
  (
    LOAD_URL="$URL" LOAD_MINUTES=2 MMO_API_TOKEN="$(secret api-token)" MMO_OPERATOR_TOKEN="$(secret operator-token)" \
      "$HARNESS" load -out "$OUT/load" >"$OUT/load.out" 2>"$OUT/load.err" &
    pid=$!
    (sleep "$LOAD_CAP" && kill "$pid" 2>/dev/null) &
    w=$!
    rc=0
    wait "$pid" || rc=$?
    kill "$w" 2>/dev/null || true
    wait "$w" 2>/dev/null || true
    exit "$rc"
  ) || rc=$?
  stop_world
  [ "$rc" = 0 ] || fail "harness load exited $rc: $(tail -3 "$OUT/load.err")"
  jq -e '.rows[] | select(.target == "load-tick-inside") | .holds' "$OUT/load/readings.json" >/dev/null ||
    fail "load-tick-inside does not hold: $(jq -r '.rows[] | select(.target == "load-tick-inside") | .value' "$OUT/load/readings.json")"
  note "load-tick-inside holds: $(jq -r '.rows[] | select(.target == "load-tick-inside") | .value' "$OUT/load/readings.json")"
}

# Report's before and after against epoch 0001.
report() {
  rc=0
  (
    "$HARNESS" all -out "$OUT/report" -only check,season,social,economy-10,social-alone -against "$EPOCH0001" >"$OUT/report.out" 2>&1 &
    pid=$!
    (sleep "$REPORT_CAP" && kill "$pid" 2>/dev/null) &
    w=$!
    rc=0
    wait "$pid" || rc=$?
    kill "$w" 2>/dev/null || true
    wait "$w" 2>/dev/null || true
    exit "$rc"
  ) || rc=$?
  [ "$rc" = 0 ] || fail "harness all exited $rc: $(tail -3 "$OUT/report.out")"
  md="$OUT/report/report.md"
  [ -s "$md" ] || fail "no report.md"
  grep -q '^Check: pass' "$md" || fail "the report does not say Check: pass"
  ! grep -q '| now misses |' "$md" || fail "a row now misses: $(grep '| now misses |' "$md" | cut -c1-200)"
  ! grep -Eq '\| (new|removed) \|$' "$md" || fail "a row is new or removed: $(grep -E '\| (new|removed) \|$' "$md" | cut -c1-200)"
  # A row may read "now holds" only where every reading that missed before
  # came from a label this subset does not run.
  jq -e --slurpfile before "$EPOCH0001" --slurpfile suite "$OUT/report/suite.json" '
    ($suite[0].labels | map(.label)) as $ran |
    ($before[0].targets | map({(.id): .}) | add) as $b |
    [.[] | select(.holds == "yes" and $b[.id].holds == "no") |
      $b[.id].readings | map(select(.measured and (.holds | not)) | .label) | all(. as $l | $ran | index($l) | not)] | all' \
    "$OUT/report/report.json" >/dev/null || fail "a row reads now holds on a label this subset ran"
  changes=""
  for c in same moved "now holds" unmeasured; do
    changes="$changes${changes:+, }$(grep -c "| $c |\$" "$md" || true) $c"
  done
  note "report: Check: pass; $changes; no now misses ($(jq -r '[.[] | select(.holds != "–")] | length' "$OUT/report/report.json") targets measured)"
}

step tests tests
step build build
step reopen reopen
step two-servers two_servers
step restore restore
step forget forget
step export export_
step load load
step report report
say "holds: restore, two servers, load, the epoch, the export, forget, reopen, report"
