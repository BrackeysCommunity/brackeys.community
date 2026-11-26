#!/bin/sh
# A world's backup (GDD 19): every mmo table, the fact log and the ledger
# with them, as one pg_dump in custom format, and a manifest beside it
# that names the world, its tick and digest, its sheets, key version and
# rules epoch, its row counts, the build and the dump's sha256. The
# manifest is read first, so the dump holds that tick or a later one.
# Nothing secret is written: the database holds no key, and the manifest
# names none.
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
trap '[ -n "$done" ] || rm -f "$stem.dump.part" "$stem.manifest.json"' EXIT
trap 'exit 1' INT TERM
pg_dump --schema=mmo --format=custom --no-owner --no-privileges --file="$stem.dump.part" "$DATABASE_URL"
mv "$stem.dump.part" "$stem.dump"
op backup-manifest -seal "$stem.dump"
done=1
echo "$stem.dump"
