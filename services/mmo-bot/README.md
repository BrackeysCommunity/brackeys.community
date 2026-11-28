# mmo-bot

The Discord MMO's bot: the hub and every chat card of the game, a client of
the world service (`services/mmo-world`) and nothing more.

**It holds no rule that decides an outcome, no seed and no key.** Every
press becomes one request to the world, and the world's reply is the only
result a card shows. The commands are pure (`src/flow.ts`); `src/adapter.ts`
is the only file that imports discord.js. The bot connects to the gateway
with the `Guilds` intent alone: it reads no messages, no member lists and
no presence, so it needs no privileged intent.

What it does:

- Answers the commands in `src/manifest.ts`: `/play`, `/character`,
  `/recipes`, `/map`, `/market`, `/goals`, `/guild`, `/party`,
  `/chronicle`, the consoles `/staff` and `/admin`, `/forget-me`, and the
  message command Report. The Activity's launch entry point is the
  application's own command; the bot answers it with the launch response.
- Keeps party threads, and posts to each server's channels: the market and
  notice-board forums, the events channel (troubles, arcs, seasons, hunts),
  the chronicle channel (one post per world day, each promotion and each
  rules-epoch notes card as it happens) and the log channel.
- Sends a direct message when a long action finishes.

Further reading:

- [docs/admins.md](docs/admins.md): the guide for a server's admins.
- [docs/verification.md](docs/verification.md): Discord's verification,
  limits and the test app, for the owner.
- [../mmo-world/README.md](../mmo-world/README.md): the world service the
  bot talks to, its tokens and the deploy order.

## Environment

Every name `src/config.ts` reads. `.env.example` lists them with empty
values; `bun run local` and `bun run register` read `.env.local`
(gitignored). A missing required value stops the bot at start.

| Name                    | Secret                          | What it is                                                                                                                                                      |
| ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`         | yes                             | The bot user's token (Developer Portal, the app's Bot page). Required.                                                                                          |
| `DISCORD_APP_ID`        | no                              | The application id. Required.                                                                                                                                   |
| `DISCORD_GUILD_ID`      | no                              | The primary server. Its channel ids in this table are used as they are. Required with guild commands, optional with global ones.                                |
| `MMO_GUILD_IDS`         | no                              | Comma-separated server ids the guild-scoped commands go to; the primary server alone when unset.                                                                |
| `MMO_COMMANDS`          | no                              | `guild` (the default, for test servers) or `global` (for launch).                                                                                               |
| `MMO_WORLD_URL`         | no                              | The world service's address; `http://localhost:8080` when unset.                                                                                                |
| `MMO_API_TOKEN`         | yes                             | The world's player-path token. Set one token here, even while the world accepts `new,old` during a rotation.                                                    |
| `REDIS_URL`             | yes, when it carries a password | Redis for the press limit, the posters' marks, party threads, held names and narration.                                                                         |
| `MMO_THREAT_LINE`       | no                              | The threat line routes stop before; the world's ambush line when unset.                                                                                         |
| `MMO_MARKET_FORUM`      | no                              | The market forum, by id or name, for a server whose settings map none.                                                                                          |
| `MMO_GOALS_FORUM`       | no                              | The notice-board forum, by id or name, likewise.                                                                                                                |
| `MMO_GAME_CHANNEL`      | no                              | Where the hunt cards go when no events channel is set.                                                                                                          |
| `MMO_EVENTS_CHANNEL`    | no                              | The events channel, by id or name, likewise.                                                                                                                    |
| `MMO_CHRONICLE_CHANNEL` | no                              | The chronicle channel, by id or name, likewise.                                                                                                                 |
| `MMO_LOG_CHANNEL`       | no                              | The log channel, by id or name, likewise.                                                                                                                       |
| `MMO_EVENTS_ALARM_ROLE` | no                              | The role a raid's start mentions in the primary server where its settings name none. Other servers name theirs in /admin. It must sit below the bot's own role. |
| `LEXICON_REFRESH_MS`    | no                              | How often the world's lexicon is read again, so found names reach the cards; five minutes when unset.                                                           |
| `ANTHROPIC_API_KEY`     | yes                             | The model's key. Held so that the config never prints it.                                                                                                       |
| `MMO_NARRATION`         | no                              | `on` turns narration's master switch on.                                                                                                                        |
| `MMO_NARRATION_DAY_USD` | no                              | The world-wide narration budget a world day, in dollars; 1 when unset.                                                                                          |

How each secret is generated, held and rotated is in
[../mmo-world/docs/keys.md](../mmo-world/docs/keys.md).

A channel given by id is used only in the server that holds it, so an id
names the primary server's channel. A channel given by name is looked up in
each server, so a server that names its channels the same way is posted to
without mapping them. A server's own settings always come first.

## Run

```sh
bun install
bun run local          # the bot with .env.local
bun run start          # the bot with the environment it is given (a deploy)
bun test               # every test
bunx tsc --noEmit -p . # types
```

A world on this machine for the bot to talk to:

```sh
scripts/local-world.sh         # Postgres, Redis and the world on :8080, 30-second ticks
scripts/local-world.sh stop    # stop it; wipe also deletes it
```

It is disposable unless `MMO_KEPT=1`, which keeps it as players would and
writes a generated `MMO_API_TOKEN` to `$MMO_LOCAL_OUT/api-token` (never
printed). `PORT`, `PGPORT`, `REDISPORT` and `MMO_TICK_SECONDS` move it off
the defaults; the header of the script lists what else it passes to the
world. It never points at a shared database.

The scripted runs press through the game as players would, against a local
world, and print one JSON summary:

```sh
bun run scripted                                   # the solo loop
bun run src/scripted.ts --season                   # and a season
bun run src/scripted.ts --two-servers <world url>  # two servers on one world (manual clock)
bun run src/scripted.ts --posters <world url> --guilds a,b
```

`SCRIPTED=party`, `crime` or `house` picks the party, crime or house run;
`--narration off|stub` never calls the model.

## Register the commands

The bot registers its commands when it connects, in the scope
`MMO_COMMANDS` names, and changes nothing when Discord already holds the
same manifest. `bun run register` does it by hand:

```sh
bun run register                          # each server in MMO_GUILD_IDS
bun run register --force                  # even when nothing changed
bun run register --global                 # globally, for every server the bot is in
bun run register --global --clear-guilds  # globally, then empty each guild copy
bun run register --clear-guilds           # only empty the guild copies
```

- **Guild scope** is for test servers: changes show at once, and the
  commands exist only in the listed servers. The posters then follow only
  those servers too.
- **Global scope** is for launch: a server that installs the bot has the
  commands without its id being known ahead of time, and the posters follow
  every server the bot is in. Discord's own notes on global commands are in
  [docs/verification.md](docs/verification.md).
- **Moving to global:** run `bun run register --global --clear-guilds`
  once, so the test servers do not show every command twice, then set
  `MMO_COMMANDS=global`. A global registration keeps the Activity's entry
  point command in place.

## Posters and Redis

Each poster polls the world and posts one server's channel. They follow the
servers the bot is in: every server at connect, then each it joins or
leaves; a server lost in an outage stays followed.

| Poster       | Posts to                                                                        | Polls |
| ------------ | ------------------------------------------------------------------------------- | ----- |
| Hunts        | the events channel, else the game channel                                       | 10 s  |
| Events       | the events channel; a raid's start mentions the alarm role outside quiet hours  | 10 s  |
| Chronicle    | the chronicle channel, one post per closed world day                            | 60 s  |
| Promotions   | the chronicle channel: each promotion and each rules-epoch notes card           | 15 s  |
| Market       | the market forum: a post per settlement, a reply each world day with its trades | 60 s  |
| Notice board | the notice-board forum: a post per public goal, edited as it moves              | 60 s  |
| Log          | the log channel, every staff and admin action                                   | 15 s  |
| Party        | party threads                                                                   | 5 s   |

A channel comes from the server's own settings, else from this README's
environment. A server with no channel of a kind gets no posts of it.

**Redis holds** (keys under `mmo-bot:` and `mmo-narr:`): each poster's mark
of what it has posted, per server and channel; the press limit (30 presses
in 10 s a user); the party threads and their members; the forums' open
posts; names held for review; and narration's cache, budget, caps and
switch. Without `REDIS_URL` the bot still plays, but posts to no channel,
forum or log (a restart would post everything again), keeps party threads
in memory and keeps narration off.

## Narration

Narration is off unless three things hold: `MMO_NARRATION=on`, an
`ANTHROPIC_API_KEY`, and Redis. Off, every card is its template; the bot
logs which at start.

On top of the master switch sits a switch in Redis, with three levels: the
whole world, each use, and each server. The world and the uses are on
unless set off; a server is off until set on, which is what a server's
admin does with Narrate in `/admin` settings. The bot reads a flip within
30 seconds. The operator flips it by hand:

```sh
bun run scripts/narration-switch.ts status
bun run scripts/narration-switch.ts all off
bun run scripts/narration-switch.ts use voice off
bun run scripts/narration-switch.ts server <server id> on
```

**The day cap.** `MMO_NARRATION_DAY_USD` is the world-wide budget a world
day (1 dollar when unset). Once a day's estimated cost reaches it, every
use falls back to its template until the next world day. Some uses also
cap each player a day (the per-use caps are in
`packages/mmo-narrate/src/uses.ts`). `scripts/narration-ledger.ts` reads
the day's spend from Redis; `scripts/narration-held.ts` lists the names the
screen held for review.

## Forgetting a player

`/forget-me` asks once, tells the world (GDD 14.9) and clears the bot's own
Redis notes of the user; a failure is said on the card, and running it again
finishes it. For an emailed request, an operator runs:

```sh
REDIS_URL=<the bot's Redis> bun run forget <discord id>
```

What is cleared, and the rest of the operator's path, are in
[../mmo-world/docs/forget.md](../mmo-world/docs/forget.md).
