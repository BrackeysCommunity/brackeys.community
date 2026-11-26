#!/bin/sh
# Puts a commit's book (its sheets/ and packs/) at epoch-from/, the second
# sheets root an epoch deploy's image carries at /app/epoch-from beside its
# own book at /app (docs/epochs.md). Commit epoch-from/ with the deploy that
# takes the epoch, and remove it in the deploy after.
#
#   scripts/epoch-root.sh <commit of the world's current book>
#   scripts/epoch-root.sh --remove
set -eu
cd "$(dirname "$0")/.."
REF="${1:?usage: scripts/epoch-root.sh <commit of the current book> | --remove}"
rm -rf epoch-from
[ "$REF" = --remove ] && exit 0
git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || {
  echo "epoch-root: $REF is not a commit" >&2
  exit 2
}
mkdir -p epoch-from
git -C "$(git rev-parse --show-toplevel)" archive "$REF:services/mmo-world" sheets packs | tar -x -C epoch-from
echo "epoch-root: epoch-from/ holds the book of $(git rev-parse --short=12 "$REF"); the world refuses it at open unless it is the world's own"
