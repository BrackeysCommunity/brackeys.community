# mmo-world

The Discord MMO's world service (GDD 19): the sim, its sheets and packs,
the tick loop, the HTTP API the bot and the web clients call, the Activity's
listener, the operator CLI (`op`) and the balance harness.

**The world service is the only writer of game state and the only holder
of the keys.** The bot, the Activity and the web clients read and press; every
write goes through a recorded command, so a snapshot plus the recorded
actions replays to the same digest. The master secret lives only in this
service's environment ([docs/keys.md](docs/keys.md)).

## Run it locally

`services/mmo-bot/scripts/local-world.sh` runs a world on this machine: its
own Postgres (with the mmo migrations), a Redis for the bot and the world
service. Run it from the repository root:

```sh
# a disposable world on :8080 with 30-second ticks
services/mmo-bot/scripts/local-world.sh
# a kept world, as players keep it, on other ports
MMO_KEPT=1 MMO_LOCAL_OUT=out/kept PORT=18080 PGPORT=15439 REDISPORT=16389 MMO_TICK_SECONDS=3 \
  services/mmo-bot/scripts/local-world.sh
services/mmo-bot/scripts/local-world.sh stop   # or wipe, which also deletes it
```

A kept world has no `MMO_DISPOSABLE` and an `MMO_API_TOKEN` generated
once into `$MMO_LOCAL_OUT/api-token`; the operator token is
`local-operator`. Keep `MMO_LOCAL_OUT` short: Postgres's socket lives in
it. `MMO_SHEETS_ROOT`, `MMO_SHEETS_FROM`, `MMO_SHEETS_NEXT`,
`MMO_ROLL_EPOCH`, `MMO_ROLL_EPOCH_NEXT`, `MMO_MANUAL_CLOCK` and
`MMO_FORGET_TOKEN` pass through to the world. Each start builds the binary
to a new file name.

## Environment

The world service reads these (`service/env.go`, `gateway/env.go`). Secret
ones never go in the repository, a log, a dump or an export.

| Name                    | What it is                                                                                                  | Secret         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| `MMO_MASTER_SECRET`     | 32 or more random bytes, base64; every key derives from it. Unset once read                                 | yes            |
| `MMO_WORLD_ID`          | The world's id                                                                                              | no             |
| `MMO_ROLL_EPOCH`        | The roll epoch the roll key is derived under; required                                                      | no             |
| `MMO_ROLL_EPOCH_NEXT`   | The roll epoch the next rules epoch steps to ([docs/epochs.md](docs/epochs.md))                             | no             |
| `MMO_KEY_VERSION`       | The key version stored with the world (default 1)                                                           | no             |
| `MMO_SHEETS_ROOT`       | The directory holding `sheets/` and `packs/` (the image sets it)                                            | no             |
| `MMO_SHEETS_NEXT`       | A sheets root the world takes as a rules epoch at its next season's close                                   | no             |
| `MMO_SHEETS_FROM`       | A kept world's old sheets digest, re-stamped onto these sheets once, off-boundary                           | no             |
| `DATABASE_URL`          | The world's Postgres                                                                                        | yes (password) |
| `MMO_TICK_SECONDS`      | Seconds a tick (default 600)                                                                                | no             |
| `MMO_POLL_MS`           | How often the loop looks for a due tick (default 1000)                                                      | no             |
| `PORT`                  | The API's port (default 8080); private network only                                                         | no             |
| `LOG_LEVEL`             | `debug`, `info` (default), `warn`, `error`                                                                  | no             |
| `MMO_API_TOKEN`         | The bot's bearer token for the player paths; required unless the world is disposable or on the manual clock | yes            |
| `MMO_OPERATOR_TOKEN`    | The bearer token for `/v1/operator` paths; unset, they are closed                                           | yes            |
| `MMO_MAP_TOKEN`         | Reads only the live map's paths, for the web map                                                            | yes            |
| `MMO_FORGET_TOKEN`      | Opens only `/v1/forget`, for the MMO's own web surface; unset, no web path forgets                          | yes            |
| `MMO_MANUAL_CLOCK`      | `1`: the due tick is set through `/v1/operator/clock` (tests and drills)                                    | no             |
| `MMO_DISPOSABLE`        | `1`: a world that may be wiped; never on a world players keep                                               | no             |
| `POSTHOG_KEY`           | The analytics project key; unset, nothing is sent                                                           | no             |
| `POSTHOG_HOST`          | The analytics host (PostHog's US host when unset)                                                           | no             |
| `MMO_URL`               | Where `op` and the harness find the service                                                                 | no             |
| `MMO_ACTIVITY_PORT`     | The Activity's public listener; unset, none                                                                 | no             |
| `MMO_ACTIVITY_DIR`      | The Activity's static build (the image sets it)                                                             | no             |
| `MMO_ACTIVITY_DEV`      | `1`: sign in by naming a Discord user; only on a disposable world                                           | no             |
| `MMO_DISCORD_API`       | Discord's API base, so a test can fake it                                                                   | no             |
| `DISCORD_APP_ID`        | The Discord application the Activity belongs to                                                             | no             |
| `DISCORD_CLIENT_SECRET` | The application's OAuth secret, for the Activity's sign-in. Unset once read                                 | yes            |

Every token setting takes one token, or `new,old` while rotating; clients
send one. `MMO_COMMIT` names the build in a backup manifest and in the
harness's readings (default the binary's or git's revision).

## Deploy order

For a deploy that carries a migration or a rules epoch:

1. A backup (`scripts/backup.sh`, [docs/backups.md](docs/backups.md)).
2. Migrations, through the drizzle migrator (the `drizzle/` folder at the
   repository root, until the MMO's schema moves out with its split from
   the site).
3. The world service, with `MMO_SHEETS_FROM` or `MMO_SHEETS_NEXT` as the
   world's state needs ([docs/epochs.md](docs/epochs.md)).
4. The bot, after the world: it reads new wire fields only once the world
   serves them.
5. Commands registered again when the manifest changed (`bun run register`
   in `services/mmo-bot`).
6. The web clients' env last (the live map's `MMO_WORLD_URL` and
   `MMO_MAP_TOKEN`).

One replica: a second instance waits in standby on the world's advisory
lock (health up with `standby: true`, the API down), which is what a
rolling deploy needs.

## The operator CLI

`go run ./cmd/op` (or the `op` binary in the image) prints its usage. Reads
and writes go through the running service with `MMO_URL` and
`MMO_OPERATOR_TOKEN`, so every correction is a recorded command:
`op inspect character <id>`, `op audit`, `op economy`, `op digest`,
`op correct`, `op ban`, `op forget`, `op story`, `op emergence`,
`op house-log` and the rest. A few read the database directly, with the
service's environment:

- `op replay [-from N] [-to M]`: re-runs recorded ticks against their
  digests, inside one rules epoch (needs the world's keys).
- `op verify [-manifest FILE]`: checks a restored world before its service
  starts (needs the world's keys).
- `op export -out DIR`: recorded play, pseudonymised (no key).
- `op backup-manifest`: a backup's manifest (no key).

Pass `-id <interaction id>` before the command to make a write's rerun
apply once.

## The harness

`go run ./cmd/harness` runs the balance harness (GDD 18.4); its usage is
the comment at the top of `cmd/harness/main.go`. The commands an operator
needs around a sheet change:

- `harness all -out DIR` runs every label of `harness.Suite`, then writes
  `DIR/report.md` against the last epoch; `-soak` adds the soak, `-live URL` adds the load run, `-only label,...` picks labels.
- `harness report -in DIR` merges a suite's readings against the last
  epoch file in `harness/epochs/`; `-write FILE` writes a new epoch file.
- `harness report -check` exits 1 when the newest epoch file is not of the
  current book: no sheet change ships without its report (GDD 18.1).
- `harness digest` prints the book's digest, the value `MMO_SHEETS_FROM`
  takes.

`scripts/full-soak.sh` runs the full suite with the soak beside
`scripts/launch-rehearsal.sh` (a kept local world taking a rules epoch at
a season boundary); both are several hours.

## Docs

| Doc                                                                  | For                                              |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| [docs/runbooks/world-down.md](docs/runbooks/world-down.md)           | The world is not answering or not ticking        |
| [docs/runbooks/bad-tick.md](docs/runbooks/bad-tick.md)               | A tick keeps failing, or the world does not load |
| [docs/runbooks/ledger-mismatch.md](docs/runbooks/ledger-mismatch.md) | The conservation check found discrepancies       |
| [docs/runbooks/leaked-key.md](docs/runbooks/leaked-key.md)           | A secret left its environment                    |
| [docs/backups.md](docs/backups.md)                                   | Backups, restores and the restore drill          |
| [docs/keys.md](docs/keys.md)                                         | Every secret: where it lives, how it rotates     |
| [docs/epochs.md](docs/epochs.md)                                     | Taking a rules epoch on a live world             |
| [docs/export.md](docs/export.md)                                     | The recorded-play export for the tuning pass     |
| [docs/forget.md](docs/forget.md)                                     | Deleting a player's data                         |
| [docs/load.md](docs/load.md)                                         | The load run                                     |
| [docs/launch-checklist.md](docs/launch-checklist.md)                 | The owner's steps to launch                      |

The bot's operator docs are `services/mmo-bot/README.md`; a server admin's
guide and Discord's verification are under `services/mmo-bot/docs/`.
