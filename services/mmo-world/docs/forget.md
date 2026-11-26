# Forgetting a player

A player may ask for their data to be deleted (GDD 14.9). The world keeps
its history whole, so a forget removes who the player was, not what the
world remembers happened: their character's deeds stay, told as a
traveller's. It is done within 7 days of the request: the identity goes at
once, the holdings at the character's first free tick.

## The ways in

| Path    | How                                                              | What it calls                                                                                 |
| ------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Discord | `/forget-me`: a card says what goes and what stays, then Confirm | `POST /v1/actions` with the `forget` action, then the bot deletes its Redis keys for the user |
| Email   | The operator runs `op forget`                                    | The operator path, the same recorded command                                                  |

Both record one `forget` command, idempotent on its interaction id, so a
repeat writes nothing new. `POST /v1/forget` (with `MMO_FORGET_TOKEN`,
which opens nothing else) records the same command for a web client: the
MMO's own web surface, on its subdomain, will call it once the owner
settles that surface. Until then the token stays unset and no web path
forgets.

## Forgetting by hand (an emailed request)

1. Find the character from the Discord user id in the request (the API
   token's path):

   ```sh
   curl -s -H "Authorization: Bearer $MMO_API_TOKEN" "$MMO_URL/v1/player?discordId=<discord id>"
   ```

   An empty `characterId` means the world holds nothing of that user (or
   it was forgotten already).

2. `op forget <character> <note...>`. The note is kept with the command for
   the life of the world: say why ("emailed request"), never who asked or
   how to reach them.
3. Reply to the request once the checks below pass.

## What the world does

| Where                                                | Kept or removed                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mmo.character`                                      | The row stays; its Discord id becomes `forgotten:<character id>` at once                                                                                                                                                                                                                                                                                                       |
| `mmo.house_log`                                      | Rows stay; the Discord id on the character's and the user's rows is blanked                                                                                                                                                                                                                                                                                                    |
| `mmo.map_seen`, `mmo.map_sight`                      | The character's rows are deleted                                                                                                                                                                                                                                                                                                                                               |
| `mmo.action`, `mmo.fact`, `mmo.snapshot`, `mmo.tick` | Kept, for replay; they name the character id only, shown to others as "a traveller"                                                                                                                                                                                                                                                                                            |
| The ledger                                           | Kept; at the first tick the character is free its holdings leave it in one transaction keyed `forget-<character id>`: coin to `sink:forgotten`, staged goods and items to `sink:staged`, every other good, item and provision to its tile's spoils pool. Its market orders, goal escrow, party and guild are withdrawn first. Anything reaching it later is swept the same way |
| The sim                                              | Every later command on or naming the character is refused `forgotten`; no new fact kind, no draw                                                                                                                                                                                                                                                                               |
| The bot's Redis                                      | `/forget-me` deletes the user's press limit, narration lines and counts, names held for review and party member entries                                                                                                                                                                                                                                                        |
| Posted Discord messages                              | Stay in each server's channels; they are the server's                                                                                                                                                                                                                                                                                                                          |
| Backups                                              | Hold the Discord id until they age out, 90 days at most ([backups.md](backups.md))                                                                                                                                                                                                                                                                                             |
| Exports                                              | Hold no identity ([export.md](export.md))                                                                                                                                                                                                                                                                                                                                      |

The email path and `POST /v1/forget` do not reach the bot. Its press-limit and
narration keys for the user expire on their own; names held for review
and party member entries stay until the user runs `/forget-me`, which
clears them even with no character left.

## The analytics person

The world's `mmo_action` events carry the character id as their distinct
id, never the Discord id. In PostHog, open Persons, find the character id,
and delete the person with its events. This is the owner's step.

## Checking it

- `op inspect character <character>`: `forget` (the tick asked) and, once
  swept, `forgotten` are set; it holds no coin, goods or items.
- `GET /v1/player?discordId=<discord id>` returns an empty `characterId`.
- `op audit` prints no discrepancies: the sweep keeps the ledger balanced.
- `op replay` over the world day of the forget matches every tick digest.
- `POST /v1/forget` again with the same interaction id answers the same
  reply; with a new one it answers `forgotten: false`, since nothing
  links the user to the character any more.
