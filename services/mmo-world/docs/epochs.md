# Rules epochs on a live world

A sheet change is a new rules epoch (GDD 18.1 rule 5), and a live world
takes one only at a season boundary (GDD 18.5): after the closing tick of
a season, before the next season's first tick shows. What was frozen stays
frozen.

## Before

1. **The report.** Run the suite on the new book and read it against the
   last epoch:

   ```sh
   go run ./cmd/harness all -out <dir>
   go run ./cmd/harness report -in <dir> -sheets-from <a checkout of the world's book>/services/mmo-world -strict
   ```

   `report.md` shows every target before and after, and `-sheets-from`
   adds every changed cell. When it is the change to ship, write the epoch
   file with `-write harness/epochs/` and commit it with the sheets;
   `harness report -check` then passes, and fails for any book without its
   file.

2. **A backup**, the same day ([backups.md](backups.md)).
3. **The digest.** `go run ./cmd/harness digest` in each checkout prints
   its book's digest; the world's own is `sheets` in `op backup-manifest`.

## Deploy

The world image carries its build's own book at `/app`. An epoch deploy
needs the world's current book too, so it carries a second root (a
directory holding `sheets/` and `packs/`) at `/app/epoch-from`.

1. Write that root and commit the `epoch-from/` it writes with the deploy:

   ```sh
   sh scripts/epoch-root.sh <the commit of the world's current book>
   ```

2. Deploy with `MMO_SHEETS_ROOT=/app/epoch-from` (the current book) and
   `MMO_SHEETS_NEXT=/app` (the new one). To step the roll key too
   ([keys.md](keys.md)), add `MMO_ROLL_EPOCH_NEXT=<MMO_ROLL_EPOCH + 1>`; a
   roll-only epoch leaves `MMO_SHEETS_NEXT` unset.
3. At open the world builds the pending rules and loads the stored world
   under them, as the close will. A root whose book is not the world's own
   (a wrong commit) is refused, and a book that cannot run this world fails
   the deploy before any tick with `service: the pending sheets under MMO_SHEETS_NEXT do not load the world`
   ([runbooks/world-down.md](runbooks/world-down.md)): unset it, fix the
   book, deploy again. Pending sheets and roll epoch equal to the world's
   log `no epoch to take` and change nothing. A roll epoch below the
   world's fails the open.
4. Nothing is taken before the close: the world runs on its current book
   until then, and a restart in between keeps the epoch pending.
5. Once the epoch is taken, `sh scripts/epoch-root.sh --remove`, committed
   with the deploy that sets `MMO_SHEETS_ROOT=/app` (see After).

A local world or the launch rehearsal points at two checkouts instead.

## At the close

After the closing tick the world, under its lock:

1. re-stamps the world row with the new sheets digest and roll epoch in one
   statement;
2. stores the epoch's notes in `mmo.epoch_note`: every changed cell, added
   and removed row of a visible sheet with its unit, and a count of the
   hidden changes;
3. loads the world on the new rules and records the `season.epoch`
   command, so a replay sees the epoch;
4. logs one of:
   - `EPOCH TAKEN: point MMO_SHEETS_ROOT at the new sheets and unset MMO_SHEETS_NEXT`
   - `EPOCH TAKEN: point MMO_SHEETS_ROOT at the new sheets, set MMO_ROLL_EPOCH=<n>, and unset MMO_SHEETS_NEXT and MMO_ROLL_EPOCH_NEXT`

   with the season, both digests and the seen and unseen counts.

Each step can be taken again after a failure, at the next tick or the next
open. The bot's promotions poster reads the `season.epoch` event from
`/v1/story/promotions`, with the notes attached, and posts the rules-epoch
notes card ("Season N runs on new rules", GDD 17.6) once in each server's
chronicle channel. A roll-only epoch posts nothing: the roll step is never
shown.

## After

Set the world's env as the log line says and deploy:

- `MMO_SHEETS_ROOT` at the new sheets;
- `MMO_ROLL_EPOCH` at the new roll epoch, if it stepped;
- `MMO_SHEETS_NEXT` and `MMO_ROLL_EPOCH_NEXT` unset.

Until then a restart still opens (the world is at the pending stamp the
process holds) and logs `EPOCH TAKEN` again. Check:

- `op story` shows the new season;
- `op backup-manifest` shows the new `sheets` and `rulesEpoch`;
- `op audit` prints no discrepancies;
- each server's chronicle channel carries the card.

## Off the boundary: `MMO_SHEETS_FROM`

`MMO_SHEETS_FROM=<the world's old digest>` re-stamps a kept world onto
the deploy's sheets at open, once, wherever its season stands. It is for a
world that has not started its season clock, or for sheets that only add.
It logs `SHEETS RESTAMPED: OFF-BOUNDARY RESTAMP: the kept world now runs on these sheets mid-season; unset MMO_SHEETS_FROM`. Unset it after. It
stores no notes, posts no card and leaves the roll key alone; a world in
season takes an epoch instead.

## What stays frozen

- The generation and quirk keys never change, so the map not yet found
  draws as it would have.
- What was discovered keeps its frozen numbers (GDD 9.9): kinds keep their
  points, materials their tier, regions their finds, drawn floors and
  pinned content their plans.
- Recorded history stays: facts, the ledger and actions are not rewritten.

## Replays across an epoch

`op replay` replays inside one rules epoch: a range that crosses one is
refused with `crosses-epoch`, naming the epoch's tick. Replay from that
tick on. `op verify` replays from the epoch's tick when the last world day
crosses one.
