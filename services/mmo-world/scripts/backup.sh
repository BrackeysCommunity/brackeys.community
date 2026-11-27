#!/bin/sh
# A world's backup (GDD 19): a custom-format pg_dump of the mmo schema and
# a manifest beside it (docs/backups.md). The manifest is read first, so
# the dump holds its tick or a later one. Nothing secret is written.
#
#   sh scripts/backup.sh <out dir>
#
# DATABASE_URL is the world's database and MMO_WORLD_ID the world; op must
# be on PATH, with pg_dump at least the server's version. It prints the
# dump's path. Schedule and retention are in docs/backups.md.
set -eu
: "${DATABASE_URL:?}" "${MMO_WORLD_ID:?}"
if [ "$#" -ne 1 ]; then
  echo "usage: backup.sh <out dir>" >&2
  exit 2
fi
mkdir -p "$1"
stem=$(op backup-manifest -out "$1")
done=""
trap '[ -n "$done" ] || rm -f "$stem.dump.part" "$stem.dump" "$stem.manifest.json"' EXIT
trap 'exit 1' INT TERM
pg_dump --schema=mmo --format=custom --no-owner --no-privileges --file="$stem.dump.part" "$DATABASE_URL"
mv "$stem.dump.part" "$stem.dump"
op backup-manifest -seal "$stem.dump"
done=1
echo "$stem.dump"
