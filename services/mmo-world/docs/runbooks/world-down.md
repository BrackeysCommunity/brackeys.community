# Runbook: the world is down

The world is not answering, or answers and does not tick.

## Symptoms

- `GET /healthz` fails, or its body has `ok: false`:
  - `standby: true`: the process is starting (the key check, the load) or
    waits for the world's advisory lock, which another process holds.
  - `stalled: true` (503): ticks keep failing, or the world went stale (a
    failed write and a reload that failed too).
  - neither (503): the service is closing.
- `due` minus `tick` in `/healthz` keeps growing.
- The log carries `WORLD STALLED: ticks keep failing` (after five failed
  ticks in a row), and PostHog an `mmo_stall` event.
- Players see the bot's "The world service is not answering just now. Your
  last action is safe; try again in a minute." Nothing they pressed is
  lost: a press either was recorded or was refused.

## Checks, in order

1. **The process.** Is the world service running, and how often has it
   restarted? A crash loop at start is a failed open: read the last
   `world service stopped` line's `err`.
   - `must be set` or `must be a whole number`: an env name is missing or
     wrong (the README's table).
   - `store: the world was founded under other keys`: `MMO_MASTER_SECRET`,
     `MMO_KEY_VERSION` or `MMO_ROLL_EPOCH` is not the world's. Set the
     world's own values; after a rules epoch that stepped the roll key,
     `MMO_ROLL_EPOCH` is the new one ([../epochs.md](../epochs.md)).
   - `store: the world runs on other sheets`: the build carries sheets the
     world has not taken. Deploy the world's sheets, or take them as an
     epoch ([../epochs.md](../epochs.md)).
   - `service: the pending sheets under MMO_SHEETS_NEXT do not load the world`: the staged book cannot run this world. Unset
     `MMO_SHEETS_NEXT` and redeploy; fix the book.
   - `steps back from MMO_ROLL_EPOCH`: `MMO_ROLL_EPOCH_NEXT` is below the
     world's roll epoch ("a roll epoch only steps forward"). Set it above
     `MMO_ROLL_EPOCH`, or unset it.
   - `service: a key is in the database`: stop. A key reached a table;
     treat it as a leak ([leaked-key.md](leaked-key.md)).
   - `loads to digest`: see [bad-tick.md](bad-tick.md).
2. **Postgres.** Is `DATABASE_URL` reachable, is the disk full, are
   connections exhausted? `tick failed` lines naming a connection or a
   timeout are transient: the loop retries with a backoff up to a minute
   and logs `ticks run again` when one succeeds.
3. **The advisory lock.** A process logging `another service holds the world; waiting` sits in standby. Find who holds the lock (read-only):

   ```sql
   WITH k AS (SELECT hashtextextended('<world id>', 0) AS h)
   SELECT l.pid, a.application_name, a.client_addr, a.backend_start, a.state
   FROM pg_locks l JOIN pg_stat_activity a USING (pid), k
   WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1
     AND l.classid::text::bigint = (k.h >> 32) & 4294967295
     AND l.objid::text::bigint = k.h & 4294967295;
   ```

   During a deploy that is the old instance; it frees the lock when it
   stops. If no world process runs anywhere and a backend still holds it,
   end that backend with `SELECT pg_terminate_backend(<pid>)`. Never run
   two world services against one world on purpose.

4. **The logs.** The first `tick failed` line's `err` after the last
   `world service up`. A failure at the same tick every try is
   deterministic: [bad-tick.md](bad-tick.md).

## Restart

Restart the service. It takes the lock, loads the world, checks its
digest, and runs every tick that fell due while it was down, in order, one
transaction each: nothing is skipped and the world catches up on its own.
A standby takes the lock as soon as the holder lets go.

## After

- `/healthz` answers `ok: true` and `due` minus `tick` falls to 0 or 1.
- `op digest` moves with each tick.
- `op audit` prints no discrepancies.
- `GET /v1/operator/ticks` shows the catch-up's steps; once caught up,
  `behind` stays at 0 or 1.

## When to restore instead

Only when the stored world is lost or damaged (the database is gone, or a
load fails on a digest no code change explains). A restore loses every
tick after the backup. Follow [../backups.md](../backups.md). A restore into
a new database runs the migrations on it first ([../backups.md](../backups.md)).
