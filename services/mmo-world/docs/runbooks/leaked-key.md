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
| `MMO_FORGET_TOKEN`      | Forgetting any player whose Discord id is known                                  | Rotate it at once, the world and its web client; then list the forgets (below)                             |
| `DISCORD_CLIENT_SECRET` | Signing in to the Activity as the application                                    | Reset it in the Discord Developer Portal (the application's OAuth2 page), set it on the world, restart     |
| `DISCORD_TOKEN`         | The bot itself: posting, reading what the bot reads                              | Reset it in the Developer Portal (the application's Bot page), set it on the bot, restart                  |
| `ANTHROPIC_API_KEY`     | The narration's model spend                                                      | Revoke it in the model provider's console, make a new one, set it on the bot, restart                      |
| `DATABASE_URL`          | The whole world, Discord ids included                                            | Rotate the database password on the platform, set the new URL on the world and the backup service, restart |
| `MMO_MASTER_SECRET`     | Every key: the map not yet found, every quirk, every roll to come                | See below                                                                                                  |
| A backup dump           | Every Discord user id the world keeps, and every character's play; no key        | A privacy incident: tell the owner                                                                         |

### Rotating a token

Every token setting on the world takes `new,old`:

1. Make the new token: `head -c 24 /dev/urandom | base64 | tr -d '/+='`.
2. Set the world's setting to `<new>,<old>` and restart the world. Both
   work now.
3. Set each client's setting to `<new>` alone and restart it (the bot for
   `MMO_API_TOKEN`; the web clients for `MMO_MAP_TOKEN` and `MMO_FORGET_TOKEN`;
   operators' shells for `MMO_OPERATOR_TOKEN`).
4. Set the world's setting to `<new>` alone and restart. The old one is
   refused with 401.

When the token leaked, step 2 can go straight to `<new>` alone: the
clients fail with 401 until step 3, which is better than leaving the old
one open.

### The master secret

The generation and quirk keys are for the life of the world and cannot
change: whoever holds the master can draw the map not yet found and every
quirk, for good. Only the roll key can move, and only at a season boundary:

1. Set `MMO_ROLL_EPOCH_NEXT` to the current `MMO_ROLL_EPOCH` plus 1 and
   deploy (with or without `MMO_SHEETS_NEXT`); the world takes it at the
   next season's close and logs `EPOCH TAKEN` naming the new
   `MMO_ROLL_EPOCH` ([../epochs.md](../epochs.md)).
2. Until then, rolls are predictable to whoever holds the master. Watch
   `op economy` for characters whose wins do not look like chance.
3. The owner decides whether the world goes on with its map spoiled or a
   new world starts under a new master (a new `MMO_WORLD_ID` and secret;
   nothing carries over).

The master is never stored in the database; if the start-up key check
fails, a key reached a table: stop the world, find the table in the error,
and treat the master as leaked.

## After

- The old token gets 401 on the path it opened.
- The world starts with `key check holds: no key in the database, the log guard is armed`.
- For a forget token: every forget is a recorded command, so list them
  (read-only) and match each against a request someone made. A web
  client's interaction ids start `site-forget-`, the operator's `op-`:

  ```sql
  SELECT interaction_id, character_id, at FROM mmo.action
  WHERE world_id = '<world id>' AND kind = 'forget' ORDER BY seq;
  ```

  A forget cannot be undone (GDD 14.9): the owner decides what to tell a
  player forgotten without asking.
