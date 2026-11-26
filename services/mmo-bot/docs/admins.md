# Running the game in your server

This guide is for a Discord server's admins. The game is one world shared by
every server the bot is in. Your server gets its own guild, its own starting
settlement, its own channels and its own staff tools; the world, its history
and its rules are the same for everyone. Nothing in your settings changes the
world. They change what your server sees.

## Install

Invite the bot with the link the game's operators give you. It asks for the
`bot` and `applications.commands` scopes and these permissions, and no
others:

| Permission               | Why the bot needs it                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View Channel             | To see the channels it posts in, and to find a channel by name.                                                                                            |
| Send Messages            | To post the chronicle, events, hunts and log cards.                                                                                                        |
| Embed Links              | Every card is an embed.                                                                                                                                    |
| Attach Files             | A card's picture is uploaded with it.                                                                                                                      |
| Read Message History     | To edit its own posts in place as a day or an event moves on.                                                                                              |
| Create Posts             | To open posts in the market and notice-board forums. In a forum channel, Discord shows Send Messages under this name.                                      |
| Create Public Threads    | A party thread is public where a private one is refused.                                                                                                   |
| Create Private Threads   | A party plays in a private thread of its own.                                                                                                              |
| Send Messages in Threads | To post in party threads and reply in forum posts.                                                                                                         |
| Manage Threads           | To keep its party threads and forum posts usable: reopening one that a moderator archived or locked needs it. The bot archives its own threads without it. |
| Manage Roles             | To give and take the alarm role when a player presses the alarm button. The alarm role must sit below the bot's own role.                                  |
| Use Embedded Activities  | To launch the game's Activity, where machines and puzzles are played.                                                                                      |

The permissions integer for the link is `945161358336`, for example
`https://discord.com/oauth2/authorize?client_id=<application id>&scope=bot+applications.commands&permissions=945161358336`.

The bot reads no messages and no member list. It never needs Administrator,
Manage Messages, Manage Channels or Mention Everyone.

## The first save installs your server's guild

Open `/admin` and press **Settings**. Admins are members with the
Administrator permission. You need a character of your own first (`/play`):
every console action is sent as your character and logged under it.

The first settings you save install your server's guild if it has none (the
first `/play` from your server does the same). The guild takes your server's
name, unless another guild already holds it, and runs the first starting
settlement that no other server's guild runs. When every start is taken, the
world opens a new settlement at the next world day and your guild waits for
it. New players from your server arrive at your settlement; the admin console
names it.

## Settings

Each change in **Settings** is saved at once.

- **Channels.** Map each kind to a channel of yours: **Chronicle** (a post
  per world day, each promotion, and the notes card of a rules epoch),
  **Events** (troubles, arcs, seasons, hunts, and your staged events),
  **Market** and **Notice board** (forum channels), and **Log** (every staff
  and admin action). A kind you leave unmapped goes to the bot's default
  channel for it, if your server has one by the name the operators use;
  otherwise it is not posted. The list shows the first 24 channels the bot
  can post in, in your server's order.
- **Staff roles.** Members with Moderate Members are always staff. Add any
  other role here.
- **Alarm roles.** The role a raid's start mentions. Players toggle the
  first one on themselves with the alarm button.
- **Player names.** Hide them, and every name a player wrote reads as its
  plain generated name in your server, as a mask does.
- **Narration.** Narrate, and your server's chronicle and cards are written
  by the language model where the operators have it on; otherwise every card
  is its template. It is off until you turn it on.
- **Quiet hours.** Two times in UTC (minutes past midnight, entered as
  HH:MM). Inside them an alarm is posted without its mention. Both empty
  means none.

## The consoles

- **`/admin`**: your settlements and where new players arrive, the live
  stages, and **Stage**, **Muster** (a goal paid from the guild's treasury),
  **Settings**, **Log**, **Pins** and **Queue**.
- **`/staff`**: each settlement's staff pool, the live stages, and
  **Stage**, **Queue** and **Log**.

Discord shows `/admin` only to Administrators and `/staff` only to Moderate
Members until you say otherwise. A staff role you add in Settings also needs
the command opened to it: **Server Settings → Integrations →** the bot →
`/staff` → add the role. Opening `/admin` to other roles there shows them the
command, but the console stays for Administrators.

## Staging and the pool

A staged event is one of the templates below with its site, time and length
picked by hand; the sheets decide the creature's strength, what drops and the
odds. Admins stage any template without cost. Staff stage from the pool of
the settlement they name, and a stage is refused when the pool holds less
than it costs.

| Template     | Kind              | Event points | Staff may stage | Lasts, days |
| ------------ | ----------------- | ------------ | --------------- | ----------- |
| `contest`    | contest           | 30           | yes             | 3           |
| `storm`      | hardship          | 40           | yes             | 1           |
| `scare`      | hardship          | 40           | yes             | 1           |
| `drill`      | hardship          | 40           | yes             | 1           |
| `drop-small` | drop (40 crates)  | 60           | yes             | 2           |
| `hunt-2`     | hunt (tier 2)     | 80           | yes             | 2           |
| `fair`       | fair (40 crates)  | 120          | yes             | 1           |
| `hunt-3`     | hunt (tier 3)     | 140          | yes             | 2           |
| `drop-large` | drop (120 crates) | 150          | yes             | 2           |
| `vault`      | vault             | 60           | yes             | 2           |
| `pattern`    | pattern           | 0            | no              | 7           |

The limits, as the world's sheets hold them:

| Sheet cell                               | Value | What it means                                                          |
| ---------------------------------------- | ----- | ---------------------------------------------------------------------- |
| `liveops.params[pool-cap].value`         | 400   | A settlement's staff pool holds at most this many event points.        |
| `liveops.params[pool-refill].value`      | 20    | Event points added to each pool at every world day...                  |
| `liveops.params[pool-per-active].value`  | 4     | ...plus one more for every this many active characters of your server. |
| `liveops.params[live-stages-most].value` | 24    | Live stages one settlement may hold at once.                           |
| `liveops.params[stage-lead-days].value`  | 7     | How many days ahead a stage may open.                                  |
| `liveops.params[stage-days-max].value`   | 7     | How many days a stage may last.                                        |
| `liveops.params[crate-cap].value`        | 3     | Crates one character may open from one drop.                           |
| `liveops.params[staged-xp].value`        | 150   | Experience a character takes from staged fights in a world day.        |
| `liveops.params[queue-kept].value`       | 200   | Cases your moderation queue keeps.                                     |
| `liveops.params[reports-per-day].value`  | 5     | Reports one character may make to your server in a world day.          |
| `liveops.params[hold-days-max].value`    | 56    | The longest mute, suspension or exclusion with an end.                 |
| `map.pin-limits[admin].perDay`           | 1     | Pins your server's admins may place in a world day.                    |
| `map.pin-limits[staff].perDay`           | 2     | Pins your server's staff may place in a world day.                     |
| `map.pin-limits[staff].points`           | 60    | Event points a staff pin costs, never given back.                      |
| `map.pin-limits[admin].reachMax`         | 12    | The most tiles round a pin that it bends.                              |

Whatever is staged is labelled with who staged it (and, for staff, what it
cost), logged, pays goods and never coin, and its goods are tagged staged and
stay at your settlement. Staged facts never feed the world's traces or
promotions, and a staged event is posted only in your server's events
channel. Nobody at a server can mint coin, cancel a world arc, reach past
their own region or remove the staged tag.

## Pins

A pin fixes what a tile in your settlement's region holds: a landmark, a
site's kind, or its ground (terrain, with its ring of six tiles). On a tile
nobody has reached, it is a reservation that lands when someone first does;
on a discovered tile, it edits that tile alone. Ground can only be reserved.
A pinned place reads "Placed by the admins of" your server. Pin from **Pins** in `/admin`; **Withdraw** takes back a pin that
has not landed. The world refuses a pin with its reason when the tile cannot
be reached, is taken, would pass the region's budget, or is one your role may
not set. No server can pin goods, a dungeon or its floors.

The world's rules give staff 2 pins a day at 60 event points, but the
`/staff` console has no pin form: a staff pin is an order the operators
place for your staff.

## Moderation

The only text a player writes into the game is a name for something they
found or founded, and a goal's title and note.

- **Report.** Anyone can report any card with the message command Report
  (right-click or long-press the message → Apps → Report) and one reason:
  abuse, name, spam, cheating or other. There is no free text. A second
  report of an open case joins it.
- **The queue** (**Queue** in either console) lists your open cases, newest
  first, and the names the bot's screening held back for your server, which
  can only be dismissed.
- **The six actions**, each for your server alone:

| Action          | Effect                                                               |
| --------------- | -------------------------------------------------------------------- |
| Mask            | The plain generated name shows in place of the written one.          |
| Hide a note     | A goal's title and note become generated text; the goal runs on.     |
| Mute text       | The member plays but cannot write names or notes.                    |
| Suspend posting | The member cannot post goals to your board.                          |
| Exclude         | The member cannot use your settlement; their character is untouched. |
| Escalate        | The case goes to the game's operators.                               |

A mute, suspension or exclusion lasts 1, 3, 7, 14, 28 or 56 days, or until
lifted. **What stands on this server** lists every hold, mask and hidden note
to lift. Moderation never touches coin, goods or escrow. A name shows in every
server: a mask is yours alone, and only an operator renames a thing for
everyone.

## The log

Every staff and admin action is a row: who, in what role, what, when, and
its cost in event points if any. **Log** in either console pages through it,
newest first, and the bot posts each row to your log channel. The game's
operators read every server's log.

## What players see

- A card that came from staging says so, and says who staged it.
- Before a new player starts, the bot tells them that season zero is the
  closed test, that the world is kept, what it stores (their Discord user
  id, their character and what it does, and the words they type to the bot)
  and that `/forget-me` removes them.
- **`/forget-me`** asks once, then removes the player's Discord id from the
  world and from every server's log, and their holdings from their
  character. What the character did stays in the world's history as "a
  traveller". It cannot be undone, and the player may start again. Cards
  already posted in your channels stay as they are.

## What your server's data is

The world keeps, as part of the shared world's history:

- your server's id, on every fact your server's staging and moderation
  wrote;
- your guild, its settlements, treasury and members;
- your settings: the channel and role ids you mapped, the names and
  narration choices, and quiet hours;
- your stages, pins, cases, holds, masks and log rows (each naming a
  character and, until that player is forgotten, their Discord id).

The bot keeps, in its own store: what it has posted in each of your channels
and forums, and whether narration is on for your server.

Neither keeps your server's messages, member list or channel names. The
channel and role names in **Settings** are read from Discord while the card
is open; only the ids you pick are saved.

If you remove the bot, it stops posting to your server and its commands go
with it. Your guild, settlement and history stay in the world, which every
server shares. To have your server's settings cleared, write to the privacy
contact the game's privacy notice names.
