# Backups and restores

The world is kept from season zero on, so its database is backed up and
every backup can be proved by a restore.

## What a backup holds

`scripts/backup.sh` writes two files into an out dir:

- `mmo-<world>-t<tick>-<UTC stamp>.dump`: `pg_dump --schema=mmo --format=custom` of every `mmo` table, the fact log (with its runtime
  partitions) and the ledger included.
- `mmo-<world>-t<tick>-<UTC stamp>.manifest.json`: the world, its tick and
  that tick's digest, the sheets digest, key version, rules epoch, row
  counts, the build (`MMO_COMMIT`, else the binary's revision) and the
  dump's sha256.

It holds no key and no token: the database never holds one (the world
checks at every start) and the manifest names none. It does hold every
Discord user id the world keeps, so a dump is personal data.

## Taking one

```sh
DATABASE_URL=<the world's database> MMO_WORLD_ID=<world> sh scripts/backup.sh <out dir>
```

`op` and `pg_dump` must be on PATH, `pg_dump` at least the
server's version. It writes the manifest first (`op backup-manifest -out`), then the dump, then seals the manifest with the dump's checksum
(`op backup-manifest -seal`), and prints the dump's path. A failed dump or seal
leaves neither the dump nor the manifest. The image's `backup` target (`docker build --target backup -f services/mmo-world/Dockerfile .` from the repository root)
carries `op`, the sheets and both scripts, with `backup` as its
entrypoint and `restore` beside it.

## Schedule and retention

- Nightly at 00:30 UTC, before every deploy and before every rules epoch.
- Keep 14 dailies, 4 weeklies, and the last season-close dump until 14
  days after the next season closes. Nothing older than 90 days, so a
  forgotten player's Discord id leaves the backups within 90 days.
- Store them in a private bucket only the owner and the backup service can
  read.

The scripts write to a directory; the copy to the bucket and the pruning
are the backup service's own settings on the platform.

## Restoring

```sh
DATABASE_URL=<target> SOURCE_DATABASE_URL=<the live database> \
  MMO_MASTER_SECRET=<the world's> MMO_WORLD_ID=<world> MMO_ROLL_EPOCH=<the world's> \
  MMO_SHEETS_ROOT=<the world's sheets> sh scripts/restore.sh <dir>/<stem>.dump
```

`restore.sh`:

1. refuses a target equal to `SOURCE_DATABASE_URL`;
2. checks the dump against its manifest (`op backup-manifest -check`) and
   refuses a dump that was never sealed or is damaged;
3. refuses a target that holds a world unless `RESTORE_REPLACE=1`;
4. drops the target's `mmo` schema and runs `pg_restore --exit-on-error --single-transaction`;
5. runs `op verify -manifest <the manifest>`.

`op verify` runs with the service down (it takes the world's lock and
refuses while a service holds it) and checks, stopping at the first
failure: the keys and sheets are the world's; the load recomputes the
digest and the fact and ledger counts; the conservation audit is clean;
the tick digest at the manifest's tick is the manifest's; the row counts
are at least the manifest's; and the last world day replays from its
snapshot. It prints what it checked. Start the service only after it
passes.

Take `pg_dump`, `pg_restore` and `psql` from one Postgres install at
the server's major version or newer: a dump from a newer `pg_dump` may not
read in an older `pg_restore`. Locally, that is the tools beside the
`postgres` on PATH (`$PGBIN` below).

## The restore drill on a local world

From the repository root, with the tools of the local Postgres first on
PATH:

```sh
export MMO_LOCAL_OUT="$PWD/out/drill" PORT=18080 PGPORT=15439 REDISPORT=16389 MMO_TICK_SECONDS=3
PGBIN="$(dirname "$(readlink -f "$(command -v postgres)")")"
(cd services/mmo-world && go build -o "$MMO_LOCAL_OUT/bin/op" ./cmd/op)
export PATH="$MMO_LOCAL_OUT/bin:$PGBIN:$PATH"
export MMO_URL="http://localhost:$PORT" MMO_OPERATOR_TOKEN=local-operator
export DATABASE_URL="postgres://postgres@localhost:$PGPORT/postgres?sslmode=disable" MMO_WORLD_ID=w-local
```

1. Start a kept world and play it for a minute:

   ```sh
   MMO_KEPT=1 services/mmo-bot/scripts/local-world.sh
   (cd services/mmo-world && LOAD_URL="$MMO_URL" LOAD_MINUTES=1 \
     MMO_API_TOKEN="$(cat "$MMO_LOCAL_OUT/api-token")" go run ./cmd/harness load -out "$MMO_LOCAL_OUT/play")
   ```

2. Pin the clock, so the digest holds still: restart on the manual clock
   (the due tick stays at the loaded one).

   ```sh
   services/mmo-bot/scripts/local-world.sh stop
   MMO_KEPT=1 MMO_MANUAL_CLOCK=1 services/mmo-bot/scripts/local-world.sh
   op digest > "$MMO_LOCAL_OUT/before.json"
   ```

3. Back up: `sh services/mmo-world/scripts/backup.sh "$MMO_LOCAL_OUT/backups"`
   prints the dump's path.
4. Lose the world: stop it, start its Postgres alone, drop the schema.

   ```sh
   services/mmo-bot/scripts/local-world.sh stop
   "$PGBIN/pg_ctl" -D "$MMO_LOCAL_OUT/pg" -o "-p $PGPORT -k $MMO_LOCAL_OUT" -l "$MMO_LOCAL_OUT/pg.log" start
   psql "$DATABASE_URL" -c 'DROP SCHEMA mmo CASCADE'
   ```

5. Restore; it ends with `op verify`, which must pass:

   ```sh
   (cd services/mmo-world && MMO_MASTER_SECRET="$(cat "$MMO_LOCAL_OUT/master")" MMO_ROLL_EPOCH=0 \
     MMO_SHEETS_ROOT="$PWD" sh scripts/restore.sh <the dump>)
   "$PGBIN/pg_ctl" -D "$MMO_LOCAL_OUT/pg" stop
   ```

6. Start it again on the manual clock and compare:
   `MMO_KEPT=1 MMO_MANUAL_CLOCK=1 services/mmo-bot/scripts/local-world.sh`,
   then `op digest` must equal `before.json` (the same tick and digest) and
   `op audit` must print no discrepancies.
7. Play on: move the clock 10 ticks past the digest's tick, wait for
   `op digest` to reach it, and run `op audit` again.

   ```sh
   curl -X POST -H "Authorization: Bearer $MMO_OPERATOR_TOKEN" -d '{"due": <tick+10>}' "$MMO_URL/v1/operator/clock"
   ```

8. `services/mmo-bot/scripts/local-world.sh wipe`.

## The restore drill on a staging copy

Against a scratch database on the platform, never the live one; never
restore into production to test:

1. Take the dump from the staging world's backups.
2. Restore into a fresh database with `SOURCE_DATABASE_URL` set to the
   staging world's, so the script refuses to write there.
3. Run `op verify` where the staging world's master already lives.

## Forgotten players and restores

A forget removes a player's Discord id at once ([forget.md](forget.md)),
but backups taken before it still hold it until they age out (90 days at
most). A restore of a backup older than a forget brings that id back:
before the restored world opens to players, apply those forgets again
with `op forget <character> <note...>`. The list is in the damaged
database if it still reads (the forgets query in
[runbooks/leaked-key.md](runbooks/leaked-key.md)), and in the emailed
requests since the backup's `made` time.
