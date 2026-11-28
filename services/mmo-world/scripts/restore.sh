#!/bin/sh
# Restores a backup (scripts/backup.sh) into DATABASE_URL, then proves it
# with op verify against the manifest beside the dump, before any service
# runs on it.
#
#   sh scripts/restore.sh <dir>/mmo-<world>-t<tick>-<stamp>.dump
#
# It refuses a dump its manifest does not seal, a target that is
# SOURCE_DATABASE_URL (the database backups are taken from), and a target
# that already holds a world unless RESTORE_REPLACE=1. It drops the
# target's mmo schema before pg_restore. op verify needs the world's own
# keys and sheets settings (docs/backups.md). op, psql and pg_restore
# must be on PATH. A failed restore leaves the target with no mmo schema.
set -eu
: "${DATABASE_URL:?}"
if [ "$#" -ne 1 ]; then
  echo "usage: restore.sh <dump>" >&2
  exit 2
fi
dump=$1
manifest="${dump%.dump}.manifest.json"
if [ "${SOURCE_DATABASE_URL:-}" = "$DATABASE_URL" ]; then
  echo "restore: the target is SOURCE_DATABASE_URL; a restore never writes over the database backups come from" >&2
  exit 2
fi
op backup-manifest -check "$dump"
export PGOPTIONS='-c client_min_messages=warning'
held=0
if [ "$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAq -c "SELECT to_regclass('mmo.world') IS NOT NULL")" = t ]; then
  held=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAq -c 'SELECT count(*) FROM mmo.world')
fi
if [ "$held" -gt 0 ] && [ "${RESTORE_REPLACE:-}" != 1 ]; then
  echo "restore: the target holds $held world(s); set RESTORE_REPLACE=1 to replace its mmo schema" >&2
  exit 2
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA IF EXISTS mmo CASCADE'
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$DATABASE_URL" "$dump"
exec op verify -manifest "$manifest"
