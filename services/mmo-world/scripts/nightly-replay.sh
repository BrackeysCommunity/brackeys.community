#!/bin/sh
# The nightly replay: copy a world's mmo schema from SOURCE_DATABASE_URL
# into SCRATCH_DATABASE_URL, without the fact log and ledger rows a replay
# never reads, then replay its last world day there against
# the digests the live world recorded. It writes only to the scratch
# database. Run it where the world's keys are (MMO_MASTER_SECRET,
# MMO_WORLD_ID, MMO_ROLL_EPOCH); extra arguments go to `op replay`.
set -eu
: "${SOURCE_DATABASE_URL:?}" "${SCRATCH_DATABASE_URL:?}"
if [ "$SOURCE_DATABASE_URL" = "$SCRATCH_DATABASE_URL" ]; then
  echo "nightly-replay: the scratch database must not be the source" >&2
  exit 2
fi
export PGOPTIONS='-c client_min_messages=warning'
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA IF EXISTS mmo CASCADE'
pg_dump --schema=mmo --no-owner --no-privileges \
  --exclude-table-data='mmo.fact*' --exclude-table-data='mmo.ledger_*' "$SOURCE_DATABASE_URL" | psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -q >/dev/null
DATABASE_URL="$SCRATCH_DATABASE_URL" exec op replay "$@"
