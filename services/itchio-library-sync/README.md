# itch.io Library Sync — Railway Deployment

Railway cron job that re-syncs every linked itch.io account's game library
into `user.profile_projects` in the main brackeys Postgres DB. It closes the
visibility gap for users who never revisit their profile: a game unpublished
on itch.io gets its `published` flag flipped here within a day, so it stops
showing publicly on their Brackeys profile.

This is the scheduled complement to the app's own sync paths (the explicit
"Import games" action and the Redis-throttled refresh on own-profile view,
both in `src/lib/itchio-sync.ts`).

## What it does each tick

1. Selects every `user.linked_accounts` row with `provider = 'itchio'` and a
   non-null `access_token`.
2. Sequentially per account (no concurrency, `SYNC_DELAY_MS` sleep between
   accounts — polite to api.itch.io), fetches
   `https://api.itch.io/profile/games` with the stored token.
3. Upserts: inserts unseen games (`onConflictDoNothing` against the partial
   unique index on `(profile_id, source, source_id)`), and flips `published`
   where it changed on itch.io.
4. **401/403** ⇒ token revoked: logged and skipped (the row stays; the
   profile UI's reconnect path handles re-linking). **429/5xx** ⇒ the whole
   run aborts early rather than hammering; the next cron tick retries.
5. One bad account never stops the sweep; a summary line is logged at the
   end (`synced N accounts, imported X, visibility-flipped Y, failed Z`).

## Schema

The service does **not** manage its own migrations or table definitions — it
imports `linked_accounts` / `profile_projects` straight from the main app's
`src/db/schema.ts` (copied into the image at build time).

## Railway setup

This service runs as a **Railway cron job** — the process starts on each
schedule tick, runs the sweep to completion, and exits.

1. **Create a new service** in the brackeys-web project pointing at this repo.
2. **Leave Root Directory blank** — the Dockerfile uses the repo root as its
   build context so it can copy `src/db/schema.ts` into the image.
3. **Set the Dockerfile Path** to `services/itchio-library-sync/Dockerfile`
   (also set in `railway.toml`).
4. **Cron schedule** is configured in `railway.toml` via `cronSchedule`
   (default `0 3 * * *` — daily 03:00 UTC).
5. **Environment variables** — see [`.env.example`](./.env.example). Minimum:
   - `DATABASE_URL` — reference the same Railway Postgres service variable
     the main app uses

## Running locally

```bash
cd services/itchio-library-sync
bun install
cp .env.example .env
# edit .env — point DATABASE_URL at a dev DB

bun run start
```
