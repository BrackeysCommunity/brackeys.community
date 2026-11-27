# Helpers for scripts/mm14-proof.sh, sourced by it: its Postgres and
# Redis, worlds started and stopped by pid file, the operator CLI, the
# HTTP API and the manual clock. The caller sets OUT, HERE (the module
# dir), BIN, PGBIN, PGPORT, PORT, REDISPORT, URL and SECRETS.
#
# A secret goes from its file into a child's environment or into a curl
# header file, never into an argument, a log or the console.

say() { echo "mm14-proof: $*"; }

# note says a line in the step's log and on the console (fd 3).
note() {
  say "$*"
  say "$*" >&3
}

fail() {
  say "FAIL: $*"
  exit 1
}

secret() { cat "$SECRETS/$1"; }

# put and got keep a step's findings for the steps after it, which run in
# other subshells.
put() { printf '%s\n' "$2" >"$OUT/state/$1"; }
got() {
  [ -f "$OUT/state/$1" ] || fail "no $1 from an earlier step"
  cat "$OUT/state/$1"
}

db_url() { echo "postgres://postgres@localhost:$PGPORT/$1?sslmode=disable"; }

# sql <db> <query> prints the rows unaligned, one a line.
sql() { "$PGBIN/psql" -X -q -tA -v ON_ERROR_STOP=1 -h localhost -p "$PGPORT" -U postgres -d "$1" -c "$2"; }

# migrate <db> <module dir> applies that module's mmo migrations, or the
# listed files when more arguments follow.
migrate() {
  mdb=$1
  mdir=$2
  shift 2
  if [ "$#" -eq 0 ]; then
    set -- $(cd "$mdir" && grep -o '\.\./\.\./drizzle/[^ ]*migration.sql' sqlc.yaml)
  fi
  for m in "$@"; do
    (cd "$mdir" && "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PGPORT" -U postgres -d "$mdb" -f "$m" >/dev/null)
  done
}

new_db() {
  sql postgres "CREATE DATABASE \"$1\""
}

# serving: /healthz answers and the world is open, not a standby waiting
# for the world's lock (which answers /healthz and refuses the rest).
serving() { curl -sf "$URL/healthz" 2>/dev/null | jq -e '.standby != true' >/dev/null 2>&1; }

# launch_world <log> <binary> <module dir> <db> <world id> [VAR=value...]
# starts a world in the background with the proof's keys and tokens, the
# arguments last so they win, and records its pid.
launch_world() {
  lwlog=$1
  lwbin=$2
  lwdir=$3
  lwdb=$4
  lwid=$5
  shift 5
  (
    cd "$lwdir"
    export DATABASE_URL="$(db_url "$lwdb")" MMO_WORLD_ID="$lwid" MMO_KEY_VERSION=1 MMO_ROLL_EPOCH=0 \
      MMO_TICK_SECONDS=3 PORT="$PORT"
    MMO_MASTER_SECRET="$(secret master)"
    MMO_API_TOKEN="$(secret api-token)"
    MMO_OPERATOR_TOKEN="$(secret operator-token)"
    export MMO_MASTER_SECRET MMO_API_TOKEN MMO_OPERATOR_TOKEN
    for a in "$@"; do export "${a?}"; done
    nohup "$lwbin" >>"$lwlog" 2>&1 </dev/null &
    echo $! >"$OUT/run/world.pid"
  )
}

# start_world <log name> <binary> <module dir> <db> <world id> [VAR=value...]
# launches a world and returns once it is open.
start_world() {
  wlog="$OUT/$1.log"
  shift
  launch_world "$wlog" "$@"
  for _ in $(seq 1 120); do
    serving && return 0
    kill -0 "$(cat "$OUT/run/world.pid")" 2>/dev/null || {
      tail -5 "$wlog"
      fail "the world did not start (see $wlog)"
    }
    sleep 1
  done
  fail "the world never became healthy (see $wlog)"
}

# refused_open is start_world for a world that must not open: it returns
# once the process has exited without ever answering /healthz.
refused_open() {
  wlog="$OUT/$1.log"
  shift
  launch_world "$wlog" "$@"
  for _ in $(seq 1 120); do
    serving && fail "the world opened (see $wlog)"
    if ! kill -0 "$(cat "$OUT/run/world.pid")" 2>/dev/null; then
      rm -f "$OUT/run/world.pid"
      return 0
    fi
    sleep 1
  done
  fail "the world neither opened nor exited (see $wlog)"
}

# stop_pid <pid file> stops a process this proof started.
stop_pid() {
  [ -f "$1" ] || return 0
  spid=$(cat "$1")
  kill "$spid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$spid" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$spid" 2>/dev/null || true
  rm -f "$1"
}

stop_world() { stop_pid "$OUT/run/world.pid"; }

# opc runs the operator CLI against the running world; opd runs a direct
# command (replay, verify, export) against <db> with the world's keys.
opc() {
  MMO_URL="$URL" MMO_OPERATOR_TOKEN="$(secret operator-token)" "$OP" "$@"
}
opd() {
  odb=$1
  owid=$2
  oroot=$3
  oepoch=$4
  shift 4
  DATABASE_URL="$(db_url "$odb")" MMO_WORLD_ID="$owid" MMO_KEY_VERSION=1 MMO_ROLL_EPOCH="$oepoch" \
    MMO_SHEETS_ROOT="$oroot" MMO_MASTER_SECRET="$(secret master)" "$OP" "$@"
}

# call <token> <method> <path> [body] prints the reply; status prints only
# its HTTP status. The token is a header file under SECRETS.
call() {
  if [ "$#" -ge 4 ]; then
    curl -s -X "$2" -H @"$SECRETS/h-$1" -H 'content-type: application/json' -d "$4" "$URL$3"
  else
    curl -s -X "$2" -H @"$SECRETS/h-$1" "$URL$3"
  fi
}
status() {
  if [ "$#" -ge 4 ]; then
    curl -s -o /dev/null -w '%{http_code}' -X "$2" -H @"$SECRETS/h-$1" -H 'content-type: application/json' -d "$4" "$URL$3"
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$2" -H @"$SECRETS/h-$1" "$URL$3"
  fi
}

tick() { curl -sf "$URL/healthz" | jq -r '.tick'; }

# clock_to <tick> moves the manual clock and waits for the world to reach it.
clock_to() {
  call operator POST /v1/operator/clock "{\"due\":$1}" | jq -e --argjson due "$1" '.due == $due' >/dev/null ||
    fail "the clock refused tick $1"
  for _ in $(seq 1 600); do
    [ "$(tick)" -ge "$1" ] && return 0
    sleep 0.2
  done
  fail "the world never reached tick $1 (it stands at $(tick))"
}

# next_id is a fresh interaction id; it counts in a file, since it runs in
# command substitutions.
next_id() {
  nid=$(($(cat "$OUT/state/seq" 2>/dev/null || echo 0) + 1))
  echo "$nid" >"$OUT/state/seq"
  echo "mm14-proof-$1-$nid"
}

# press <character> <kind> [json fields] sends one press at the
# character's current version and prints "ok" or the refusal's code.
press() {
  pc=$1
  pk=$2
  pf=${3:-}
  po=$(call api GET "/v1/options?characterId=$pc")
  pv=$(echo "$po" | jq -r '.version // empty')
  if [ -z "$pv" ]; then
    echo "$po" | jq -r '.code // "no-options"'
    return 0
  fi
  body="{\"interactionId\":\"$(next_id "$pk")\",\"characterId\":\"$pc\",\"version\":$pv,\"kind\":\"$pk\"${pf:+,$pf}}"
  call api POST /v1/actions "$body" | jq -r 'if .code then .code else "ok" end'
}

# create <discord id> makes a character and prints its id.
create() {
  call api POST /v1/actions "{\"interactionId\":\"$(next_id create)\",\"discordId\":\"$1\",\"kind\":\"create\"}" |
    jq -e '.character' >/dev/null || fail "create for $1 refused"
  call api GET "/v1/player?discordId=$1" | jq -r '.characterId'
}

# turn <character> presses what a player at rest would: a fight's
# default option, else a stop to what it is doing, else a rest, else a
# step where rest is not taken; it prints "<kind> <answer>".
turn() {
  to=$(call api GET "/v1/options?characterId=$1")
  if [ "$(echo "$to" | jq -r '.fight != null')" = true ]; then
    tf=$(echo "$to" | jq -c '{option: (.fight.default // .fight.options[0].id)} | tostring | .[1:-1]' | jq -r .)
    ta=$(press "$1" press "$tf")
    echo "press $ta"
  elif [ "$(echo "$to" | jq -r '.long != null')" = true ]; then
    echo "cancel $(press "$1" cancel)"
  else
    ta=$(press "$1" rest)
    if [ "$ta" = not-here ]; then
      td=$(echo "$to" | jq -r '[.moves[]? | select(.open)][0].dir // empty')
      if [ -n "$td" ]; then
        tf="\"dir\":$td"
        ta=$(press "$1" step "$tf")
        echo "step $ta"
        return 0
      fi
    fi
    echo "rest $ta"
  fi
}

# walk <character> presses a fight's default option, waits out a journey,
# or steps onto a tile it has not stood on; it prints "<kind> <answer>".
walk() {
  wo=$(call api GET "/v1/options?characterId=$1")
  wf="$OUT/state/walked-$1"
  [ -f "$wf" ] || echo '[]' >"$wf"
  if [ "$(echo "$wo" | jq -r '.fight != null')" = true ]; then
    tf=$(echo "$wo" | jq -c '{option: (.fight.default // .fight.options[0].id)} | tostring | .[1:-1]' | jq -r .)
    ta=$(press "$1" press "$tf")
    echo "press $ta"
  elif [ "$(echo "$wo" | jq -r '.long != null')" = true ]; then
    echo "journey waits"
  else
    td=$(echo "$wo" | jq -r --slurpfile seen "$wf" '[.moves[]? | select(.open) | select(.to as $t | $seen[0] | index([$t]) | not)][0] // empty | "\(.dir) \(.to | tojson)"')
    if [ -z "$td" ]; then
      echo "step none-open"
      return 0
    fi
    jq -c --argjson t "${td#* }" '. + [$t]' "$wf" >"$wf.next" && mv "$wf.next" "$wf"
    tf="\"dir\":${td%% *}"
    ta=$(press "$1" step "$tf")
    echo "step $ta"
  fi
}

# play <ticks> <character...> takes a turn for each character (a walk for
# one named walk:<id>), then moves the clock one tick, so many times; it
# counts the answers in <OUT>/state/played.
play() {
  pn=$1
  shift
  : >"$OUT/state/played"
  for _ in $(seq 1 "$pn"); do
    for c in "$@"; do
      case "$c" in
      walk:*) walk "${c#walk:}" >>"$OUT/state/played" ;;
      *) turn "$c" >>"$OUT/state/played" ;;
      esac
    done
    clock_to $(($(tick) + 1))
  done
  sort "$OUT/state/played" | uniq -c | awk '{printf "%s%s %s %s", sep, $1, $2, $3; sep=", "} END {print ""}'
}

# audit_clean fails unless op audit finds nothing.
audit_clean() {
  opc audit >"$OUT/$1.json" || fail "op audit failed"
  jq -e '(.discrepancies // []) | length == 0' "$OUT/$1.json" >/dev/null ||
    fail "op audit found discrepancies: $(cut -c1-300 "$OUT/$1.json")"
}

# replayed <file> fails unless an op replay's reply checked every tick.
replayed() {
  jq -e '.checked == .ticks and .ticks > 0' "$1" >/dev/null || fail "op replay did not check every tick: $(jq -c . "$1")"
}
