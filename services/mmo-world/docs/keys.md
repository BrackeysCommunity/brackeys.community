# Keys and secrets

Every secret the game runs on: where it lives, who holds it, how it is
made, how it rotates and what a leak means. None is ever in the
repository, a log, a database row, a dump or an export. What to do when
one leaks is [runbooks/leaked-key.md](runbooks/leaked-key.md).

## The master secret and the keys

`MMO_MASTER_SECRET` is the world's seed (GDD 19): 32 or more random bytes,
base64, made once when the world is founded:

```sh
head -c 32 /dev/urandom | base64
```

It lives in two places only: the world service's environment and the
owner's password manager. Staging and production each have their own. The
service reads it at start and unsets it; `op replay`, `op verify` and
`scripts/restore.sh` read it from the environment of the place they run,
which is the world service's own environment or a one-off run beside it.
A local world (`services/mmo-bot/scripts/local-world.sh`) makes its own
into `$MMO_LOCAL_OUT/master`, mode 600, never printed.

Three keys derive from it, with the world id (HKDF-SHA-256, `sim/keys`):

| Key        | Draws                                   | Changes                                                                                         |
| ---------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Generation | The map, sites, dungeons, every finding | Never: it fixes everything not yet discovered                                                   |
| Quirk      | The quirks items derive with            | Never                                                                                           |
| Roll       | Every roll of play                      | Only at a rules epoch at a season boundary, with `MMO_ROLL_EPOCH_NEXT` ([epochs.md](epochs.md)) |

`MMO_ROLL_EPOCH` names the roll key's version and `MMO_KEY_VERSION` the
key set's; the world row stores both and a check value of the generation
key, never a key. A process with the wrong master, key version or roll
epoch is refused at open (`founded under other keys`).

## Guards

- **The start-up check.** Before the world opens, `CheckKeys` scans every
  `mmo` table for every text form of the master and the keys (and the
  next roll key, with `MMO_ROLL_EPOCH_NEXT`) and refuses to start on a
  hit: `service: a key is in the database`. On a pass it logs `key check holds: no key in the database, the log guard is armed`.
- **The log guard.** Every log line passes a writer that replaces each of
  those forms, and `DISCORD_CLIENT_SECRET`, with `[redacted]`.
- **The export** makes a fresh random key for its pseudonyms, zeroes it at
  the end and writes it nowhere ([export.md](export.md)).

## Every secret

| Secret                  | Lives in                                                             | Made                                               | Rotates                              |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| `MMO_MASTER_SECRET`     | The world service; the owner's password manager                      | Once, as above                                     | Never; a new master is a new world   |
| `MMO_API_TOKEN`         | The world and the bot                                                | `head -c 24 /dev/urandom \| base64 \| tr -d '/+='` | `new,old` on the world (below)       |
| `MMO_OPERATOR_TOKEN`    | The world and the operator's shell                                   | The same                                           | `new,old`                            |
| `MMO_MAP_TOKEN`         | The world and the web map                                            | The same                                           | `new,old`                            |
| `MMO_FORGET_TOKEN`      | The world and the MMO's own web surface, once it has a deletion path | The same                                           | `new,old`                            |
| `DISCORD_CLIENT_SECRET` | The world (the Activity's sign-in); unset once read                  | The Discord Developer Portal                       | Reset in the portal, set, restart    |
| `DISCORD_TOKEN`         | The bot                                                              | The Discord Developer Portal                       | Reset in the portal, set, restart    |
| `ANTHROPIC_API_KEY`     | The bot, for narration                                               | The model provider's console                       | Revoke, make a new one, set, restart |
| `DATABASE_URL`          | The world, the backup service, an operator's one-off run             | The platform                                       | The platform's password rotation     |

`POSTHOG_KEY` is a project key that only sends events; keep it in the
env all the same.

## Rotating a token

Every token setting on the world accepts `new,old` while rotating, and
every client sends one token:

1. Set the world's setting to `<new>,<old>` and restart it.
2. Give each client `<new>` alone and restart it.
3. Set the world's setting to `<new>` alone and restart it.

Rotate any token that ever left its environment, and each at least once a
season.

## Never

- in the repository: `.env.local` files are gitignored; `.env.example`
  files hold names with empty values;
- in a dump or a backup manifest (the start-up check keeps keys out of the
  database; tokens are never stored);
- in an export ([export.md](export.md));
- in an `op` note: notes are kept with the command for the life of the
  world.
