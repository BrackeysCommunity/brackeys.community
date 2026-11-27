# Runbook: a leaked secret

A secret left its environment: pasted in a chat, committed, logged, in a
screenshot, on a machine that should not have it. Act on what leaked;
[../keys.md](../keys.md) says where each one lives.

## Symptoms

- Someone saw it, or it is in a commit, an issue, a log or a file.
- The world's log guard redacted one: a line with `[redacted]` in it.
- The world refused to start with `service: a key is in the database`.

## What it exposes, and what to do

| Secret                  | It exposes                                                                       | Do                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `MMO_API_TOKEN`         | Every player path: acting as any player                                          | Rotate it (below), the world and the bot                                                                   |
| `MMO_OPERATOR_TOKEN`    | Every operator path: corrections, bans, resets of a disposable world, forgetting | Rotate it, the world and every operator's shell                                                            |
| `MMO_MAP_TOKEN`         | The live map's reads, up to the world-wide cap                                   | Rotate it, the world and the web map                                                                       |
| `MMO_FORGET_TOKEN`      | Forgetting any player whose Discord id is known                                  | Rotate it at once, the world and the MMO's own web surface; then list the forgets (below)                  |
| `DISCORD_CLIENT_SECRET` | Signing in to the Activity as the application                                    | Reset it in the Discord Developer Portal (the application's OAuth2 page), set it on the world, restart     |
| `DISCORD_TOKEN`         | The bot itself: posting, reading what the bot reads                              | Reset it in the Developer Portal (the application's Bot page), set it on the bot, restart                  |
| `ANTHROPIC_API_KEY`     | The narration's model spend                                                      | Revoke it in the model provider's console, make a new one, set it on the bot, restart                      |
| `DATABASE_URL`          | The whole world, Discord ids included                                            | Rotate the database password on the platform, set the new URL on the world and the backup service, restart |
| `MMO_MASTER_SECRET`     | Every key: the map not yet found, every quirk, every roll key to come            | See below                                                                                                  |
| A backup dump           | Every Discord user id the world keeps, and every character's play; no key        | A privacy incident: tell the owner                                                                         |

### Rotating a token

Follow [../keys.md](../keys.md#rotating-a-token). When the token leaked,
step 2 can go straight to `<new>` alone: the clients fail with 401 until
they get it, which is better than leaving the old one open.

### The master secret

The generation and quirk keys are for the life of the world. Every key
derives from the master, so whoever holds a leaked master can derive them
all: the map not yet found, every quirk, and every roll key to come.

1. The only remedy is a new world under a new master (a new
   `MMO_WORLD_ID` and secret; nothing carries over). That is the owner's
   decision.
2. Meanwhile, watch `op economy` for characters whose wins do not look
   like chance.

Stepping the roll key with `MMO_ROLL_EPOCH_NEXT` at a season boundary
([../epochs.md](../epochs.md)) helps only when a derived roll key leaked
without the master, for example in a log.

The master is never stored in the database; if the start-up key check
fails, a key reached a table: stop the world, find the table in the error,
and treat the master as leaked.

## After

- The old token gets 401 on the path it opened.
- The world starts with `key check holds: no key in the database, the log guard is armed`.
- For a forget token: every forget is a recorded command, so list them
  (read-only) and match each against a request someone made. The operator's interaction
  ids start `op-`; the bot's /forget-me carries the Discord interaction id,
  a bare number; any other came through `POST /v1/forget`, with the forget token or the API token:

  ```sql
  SELECT interaction_id, character_id, at FROM mmo.action
  WHERE world_id = '<world id>' AND kind = 'forget' ORDER BY seq;
  ```

  A forget cannot be undone (GDD 14.9): the owner decides what to tell a
  player forgotten without asking.
