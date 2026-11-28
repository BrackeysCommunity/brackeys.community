# The recorded-play export

What players actually did, for the tuning pass (GDD 18.4): the harness's
policies are recalibrated from it and each sheet change is read against
it. It holds no identity, so it can go to anyone working on the balance.

## Running it

```sh
DATABASE_URL=<the world's database> MMO_WORLD_ID=<world> MMO_SHEETS_ROOT=<the world's sheets> \
  op export -out <dir> [-from-day N] [-to-day M]
```

It reads the database directly and reads no key, so it runs anywhere the
database and the world's sheets are; it refuses sheets whose digest is
not the world's (goods are valued and item xp counted by them). `-to-day`
is inclusive and defaults to the last closed world day; only days whose
closing snapshot exists are written. It prints the manifest. An export
is valued by the book the world runs on, so `op export` refuses a range
that starts before the world's last rules epoch; export from the epoch's
day on, and read earlier days from an export made before the epoch.

## The files

One JSON object a line, sorted by day, then pseudonym.

| File               | One line is                        | Fields                                                                                                                                                                                                                                               |
| ------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`    | The export                         | `schema`, `world` (a pseudonym), `book`, `rollEpoch`, `seasons`, `fromTick`, `toTick`, `made`, `records` (lines per file)                                                                                                                            |
| `beats.jsonl`      | A press on a beat                  | `day`, `tick`, `character`, `server`, `what` (fight, theft or hunt), `beat` of `beats`, `kind`, `tier`, `party`, `floor`, `ambush`, `offered` (each option's `id`, `kind`, `band`, `risk`, `riskSize`, `puzzle`), `pick`, `band`, `success`, `ended` |
| `puzzles.jsonl`    | A machine solved or failed         | `day`, `tick`, `character`, `server`, `source`, `family`, `level`, `practice`, `tier`, `party` (seats), `countdown` (ms), `ticks` (from arming to the solve), `ms`, `moves`, `solved`, `clean`, `late`, `master`, `haywire`                          |
| `days.jsonl`       | A character at a world day's close | `day`, `character`, `server`, `active`, `acted`, `actions` (by kind), `coin`, `goodsValue`, `xp`, `bestItemLevel`, `classes`                                                                                                                         |
| `milestones.jsonl` | A step reached                     | `day`, `tick`, `character`, `server`, `kind` (`class-unlocked`, `item-level-5`, `item-level-20`, `guild-founded`, `city`, `thief-invited`), `class`, `tier`, `first`, `worldFirst`, `ticksSinceBorn`, `daysSinceTheft`                               |
| `world.jsonl`      | The world at a day's close         | `day`, `world`, `season`, `seasonDay`, `characters`, `active`, `acted`, `coinPerActive`, `actions`, `peakPerMinute` (the most commands in one minute), `staged` (event points by server)                                                             |

A beat's `offered` and a puzzle's `practice`, `tier`, `countdown` and
`ticks` are what the player faced, kept with each action as it was
applied; actions recorded before the world kept them leave those fields
out.

## Pseudonyms

Characters are `c-`, servers `s-` and the world `w-` followed by 16 hex
digits of an HMAC-SHA256 over the kind and the id, under a 32-byte key
drawn at random for this export, zeroed at its end and never written.
Within one export a pseudonym is stable, so a character's days, beats and
milestones join; two exports cannot be joined to each other or to the
world.

## Left out, and why

- Discord user and server ids, interaction ids and command keys: they
  name or trace a person.
- Ledger keys, raw draws, the seed, any key or token: they would let a
  reader replay or predict the world.
- Typed text (character, guild and dungeon names, notes, titles, labels):
  players wrote it, and it can name them.
- Coordinates and place refs: with the map they locate a player.

The export package's leak test plays a world with Discord-shaped ids, a
known master and tokens, exports it and fails on any of them, in plain,
hex or base64 form, any derived key, any raw character or interaction id,
or any run of 17 to 20 digits.

## How the tuning pass reads it

- **Battle (GDD 18.4):** `beats.jsonl` gives the bands players were
  offered and what they picked; `puzzles.jsonl` gives real solve rates and
  solve times by family, practice, tier and party size, which the even
  fight, party and floor-puzzle targets are recalibrated against.
- **Growth and classes:** `days.jsonl` and `milestones.jsonl` give the
  days to a first class and to item levels 5 and 20.
- **Economy:** `world.jsonl`'s coin per active character against its
  band; `guild-founded` and `city` days against the founding targets.
- **Load:** `world.jsonl`'s `peakPerMinute` is the closed test's real peak
  for the load run ([load.md](load.md)).
- **Staging:** `staged` shows each server's event points a day.

Read the policies' predictions against it, change the cells, and run the
report ([epochs.md](epochs.md)).
