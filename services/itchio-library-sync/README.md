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

0. **Jam participation backfill** (runs first — DB-only, so it survives the
   itch.io-facing phases aborting early). The itch.io OAuth API has no jam
   endpoints, so jam participation comes from the scraped `itch.jam_entries`
   (itchio-scraper service): for every linked itchio account (token not
   required), entries are matched by uploader id
   (`author_id = provider_user_id`) or contributor profile URL (normalized;
   never by name) and mirrored into `profile_projects` as `type = 'jam'`,
   `source = 'itchio-jam'`, `source_id = entry_id` rows referencing
   `itch.jams` via `jam_id` (name/URL come from the join at read time).
   Re-runs backfill `result` ("Overall: #N of M") once the post-voting
   rate-page scrape lands, keep team rosters in step, and refresh covers
   unless the owner uploaded their own image. Mirrors the app's
   `src/lib/itchio-jam-sync.ts`. Finally, every jam placement is converged
   onto a canonical project — keyed on the entry's **game** id, so a game
   that was both jam-submitted and library-imported is one project — and the
   entry's `contributors` become credits on it.
1. Selects every `user.linked_accounts` row with `provider = 'itchio'` and a
   non-null `access_token`.
2. Sequentially per account (no concurrency, `SYNC_DELAY_MS` sleep between
   accounts — polite to api.itch.io), fetches
   `https://api.itch.io/profile/games` with the stored token.
3. Upserts: inserts unseen games (`onConflictDoNothing` against the partial
   unique index on `(profile_id, source, source_id)`), flips `published`
   where it changed on itch.io, and refreshes `image_url` from `cover_url`
   (skipped when the owner uploaded their own image — `image_key` set). Then
   converges the account's whole `itchio` placement set onto canonical
   projects (deduped on the itch game id) and fills canonical fields only the
   provider knows — `classification`, `type` (browser-playable), and
   `release_status`. Fill-if-null, never overwrite: `title` and `published`
   are deliberately never mirrored, so an owner's rename and a staff hide
   both survive the next tick.
4. **401/403** ⇒ token revoked: logged and skipped (the row stays; the
   profile UI's reconnect path handles re-linking). **429/5xx** ⇒ the whole
   run aborts early rather than hammering; the next cron tick retries.
5. One bad account never stops the sweep; a summary line is logged at the
   end (`synced N accounts, imported X, visibility-flipped Y, failed Z`).
6. **Restricted-visibility probe.** itch.io pages have three visibility
   states (Draft / Restricted / Public), but the API's `published` boolean
   only encodes Draft=false — Restricted games come back `published: true`
   with no distinguishing field (`<url>/data.json` even returns 200 for
   them). So after the API sync, the sweep anonymously `HEAD`s the public
   URL of every itch row with `published = true`: a hard **404** sets
   `restricted_at` (hidden from non-owners by `getProfile`), a **200**
   clears it. Timeouts and odd statuses prove nothing and leave the row
   untouched; **429/5xx** aborts the probe phase early. `restricted_at` is
   owned by this probe alone — the API sync keeps asserting
   `published: true` for restricted games, so the state can't live in
   `published` without being flipped back on the next sync.

7. **Jam-banner scan.** Rides on the probe: for a game whose scan is missing
   or older than `JAM_SCAN_MAX_AGE_DAYS` (default 30), the probe issues a
   `GET` instead of a `HEAD` and reads the page's `Submission to <jam>`
   button, recording the jam slugs in `itch.game_jam_scans` (keyed by itch
   game id, so a game several members hold is fetched once). The scraper's
   discovery tier ingests any slug we hold no jam for.

   This exists because the scraper can only discover jams itch _lists_, and
   itch's listings are not a complete index — a member's Candy Jam entry from
   2014 (`jam_id` 1, in no listing at all) was invisible to us while the game
   sat in their library the whole time. An empty slug array is a real result
   ("scanned, not a jam submission"), and it is what stops most games from
   being re-fetched. Rows already marked `restricted_at` are skipped: their
   page 404s, so there is nothing to read.

## Schema and shared writes

The service does **not** manage its own migrations or table definitions — it
imports `linked_accounts` / `profile_projects` straight from the main app's
`src/db/schema.ts` (copied into the image at build time).

The same goes for the **canonical-project writes**. Every placement this
sweep creates has to get a `project.projects` row behind it, or that game has
no project page and the one-time backfill script becomes something that has to
be re-run after every tick. So `src/lib/project-sync.ts` (plus the two pure
modules it pulls in, `project-taxonomy.ts` and `itch-urls.ts`) is copied into
the image and called with _this_ service's drizzle client — it takes the
handle as an argument and never imports the app's `db`. Steps 0 and 3 above
both end in a `converge*Placements` call.

**Deploy the app and this service in the same window** when either copy of
the sync orchestration changes.

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
