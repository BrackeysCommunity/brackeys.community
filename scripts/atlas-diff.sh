#!/usr/bin/env bash
set -euo pipefail

# Calculate next sequence number from existing migrations.
# Uses POSIX find + sed instead of GNU-only `-printf` / `grep -P` so the
# script works on macOS BSD utilities as well as Linux GNU.
LAST=$(find drizzle -maxdepth 1 -name '*.sql' -exec basename {} \; \
  | sed -n 's/^\([0-9]\{1,\}\)_.*/\1/p' \
  | sort -rn | head -1)
LAST=${LAST:-0}
NEXT=$(printf "%04d" $(( 10#$LAST + 1 )))

# Run atlas migrate diff, passing through all arguments
atlas migrate diff --env local "$@"

# Find the newly created file (most recently modified .sql)
FILE=$(ls -t drizzle/*.sql | head -1)
BASENAME=$(basename "$FILE" | sed 's/^[0-9]*_//')

# Rename to drizzle sequential format
mv "$FILE" "drizzle/${NEXT}_${BASENAME}"

# Rehash
atlas migrate hash --dir file://drizzle

echo "Created drizzle/${NEXT}_${BASENAME}"
