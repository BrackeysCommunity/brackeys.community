# Runbook: a bad tick

A tick keeps failing, or the world does not load.

## Symptoms

- `tick failed` lines with a growing `failures`, the waits between them
  doubling up to a minute, then `WORLD STALLED: ticks keep failing` and
  `/healthz` at `stalled: true`.
- A crash loop: a panic in the sim ends the process at the same tick every
  start.
- The open fails with `store: world <id> loads to digest <a>, stored <b>`:
  the game this build decodes is not the one that was saved.

## Checks, in order

1. **Transient or deterministic.** A transient failure (a dropped
   connection, a timeout, a full disk) names the database and clears on
   its own: `ticks run again` follows. A deterministic one fails at the
   same tick with the same error on every try and after a restart.
2. **Where the world stands.** `op digest` prints the last saved tick and
   its digest (the failing tick is the one after it). `GET /v1/operator/ticks` shows the last steps' times: a slow climb before
   the failure points at load, not at a rule ([../load.md](../load.md)).
3. **Does recorded history still replay?** `op replay -from N -to M` re-runs
   ticks from their snapshot and recorded actions on this build and stops
   at the first digest that differs. Run it over the last world day (no
   flags) and over the ticks since the last deploy.
   - It matches: history is sound; the fault is in the next tick's input
     or a bug that only this tick reaches.
   - It differs from the first tick after a deploy: that deploy changed
     what the sim computes without a rules epoch. Roll the deploy back.
   - It is refused with `crosses-epoch`: start the range at the epoch's
     tick, which the message names.
4. **A digest mismatch on open.** The sheets match (a sheets change fails
   earlier, with `runs on other sheets`), so the code is what changed:
   the state's shape or its digest. Roll back to the build that saved the
   world, and fix the change so it decodes old state to the same digest.

## The fix

The fix is a code deploy, never an edit of `mmo.*`. Every row the world
holds is checked on load (the digest, the fact chain, the ledger count),
so a hand edit makes the world fail to load, and it breaks every replay
after it.

To reproduce a deterministic failure, where the world's master already
lives and never on a laptop ([../keys.md](../keys.md)):

1. Restore a backup into a scratch database ([../backups.md](../backups.md)).
2. Run the failing build against it with `MMO_MANUAL_CLOCK=1 LOG_LEVEL=debug`.
3. `POST /v1/operator/clock` with `{"due": <saved tick + 1>}`.

## After

- `ticks run again` in the log, `/healthz` at `ok: true`, and `due` minus
  `tick` back to 0 or 1.
- `op replay` over the ticks the fix ran matches.
- `op audit` prints no discrepancies.

## When a restore is the answer

When the stored world itself is damaged and no build loads it: restore the
last backup that `op verify` accepts ([../backups.md](../backups.md)),
knowing every tick after it is lost.
