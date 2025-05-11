#!/bin/sh
set -e

SQLITE_DB_PATH="/data/brackeys.db"

echo "Creating SQLite database at $SQLITE_DB_PATH"
if [ -f "$SQLITE_DB_PATH" ]; then
  echo "Database already exists, skipping creation"
else
  sqlite3 "$SQLITE_DB_PATH" < /scripts/schema.sql
  sqlite3 "$SQLITE_DB_PATH" < /scripts/seed-data.sql
  
  echo "SQLite database created and seeded successfully"
fi

chmod 666 "$SQLITE_DB_PATH"
