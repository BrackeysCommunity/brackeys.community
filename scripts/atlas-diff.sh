#!/usr/bin/env bash
set -euo pipefail

# Calculate next sequence number from existing migrations
LAST=$(find drizzle -maxdepth 1 -name '*.sql' -printf '%f\n' | grep -oP '^\d+' | sort -rn | head -1)
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
