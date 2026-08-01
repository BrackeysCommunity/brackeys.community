# itch.io Scraper — Railway Deployment

Railway cron job that scrapes itch.io jam data (metadata, entries,
per-submission rankings) and syncs it into the main brackeys Postgres DB.

## What it scrapes

Everything is fetched with plain HTTP (`fetch` + cheerio) — every page the
scraper reads is fully server-rendered by itch.io and served without a JS
challenge, even to our self-identifying bot user agent. No headless browser
is involved (see
[docs/research/itch-scraper-browserless-deep-dive.md](../../docs/research/itch-scraper-browserless-deep-dive.md)
for the investigation that removed Browserless).

| Source                                      | Captured fields                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/jams/upcoming` (paginated)                | jam slugs for forward discovery                                                                                                                                                                                                                                    |
| `/jams/in-progress` (paginated)             | jam slugs for jams already running (catches jams first seen mid-flight)                                                                                                                                                                                            |
| `/jams/past/sort-date` (paginated, bounded) | jam slugs that ended within `ENDED_LOOKBACK_DAYS` (catches jams that started _and_ ended between runs)                                                                                                                                                             |
| `/search?q=brackeys&type=jams` (paginated)  | jam slugs for one-time Brackeys backfill                                                                                                                                                                                                                           |
| `/jam/{slug}`                               | title, numeric jam id, hosts, hashtag, status, start/end/voting-end dates, banner, entries count, ratings count, description HTML                                                                                                                                  |
| `/jam/{jamId}/entries.json`                 | every submission's id, rating count, coolness, rate URL, submission timestamp, game metadata (title, short text, cover, platforms), author and contributors — undocumented API per [itch.io thread](https://itch.io/t/1487695/solved-any-api-to-fetch-jam-entries) |
| `/jam/{slug}/rate/{gameId}`                 | per-criterion rank, adjusted score, raw score (only available on the rate page — not in the API)                                                                                                                                                                   |

### How slugs are chosen each tick

The sync set is the union of five buckets:

1. **Upcoming discovery** — every slug on every page of `/jams/upcoming`,
   walked until itch stops rendering a "Next" pager link. Always synced so
   we catch newly-announced jams as soon as they appear.
2. **In-progress discovery** — every slug on every page of
   `/jams/in-progress`. Overlaps heavily with persisted re-sync (dedupe
   handles that); its job is jams whose first appearance we missed while
   they were upcoming.
3. **Brackeys backfill** — every slug from every page of
   `/search?q=brackeys&type=jams` **that isn't already in `itch.jams`**.
   Brings in historical Brackeys jams (brackeys-1 … brackeys-15) the first
   time we see them, then drops out of the bucket forever.
4. **Recently-ended backfill** — every slug from `/jams/past/sort-date`
   (end date descending, walked until the cutoff) that ended within
   `ENDED_LOOKBACK_DAYS` **and isn't already in `itch.jams`**. This is the
   outage-recovery bucket: jams that were created and finished entirely
   between successful runs are otherwise invisible to the other buckets
   forever (as happened in the June 2026 outage).
5. **Persisted re-sync** — every slug already in `itch.jams` where the jam
   isn't "done" yet. Specifically: `status != 'over'` **or** at least one of
   its entries still has `results_fetched_at IS NULL`. Jams in terminal
   state with all rate pages collected are skipped, so we don't burn cycles
   re-scraping hundreds of historical Brackeys submissions every tick.

The `/jams` calendar page is intentionally **not** scraped — it only encodes
dates as CSS pixels and gives us nothing the per-jam page doesn't already
provide.

## Schema

The scraper does **not** manage its own migrations. All tables live in the
main brackeys drizzle schema under the `itch` Postgres schema:

- `itch.jams`
- `itch.jam_entries`
- `itch.jam_entry_results`

They're defined in `src/db/schema.ts` and picked up by `drizzle.config.ts`
(`schemaFilter: [..., "itch"]`). To materialize them:

```bash
# From repo root, after pulling this change:
bun run db:generate       # emits drizzle/00XX_*.sql + meta/ snapshot
bun run db:migrate        # applies pending migrations to DATABASE_URL
```

Staging and prod migrations run automatically via
`.gitlab/db-migrate.gitlab-ci.yml` on `main` / `prod`.

## Railway setup

This service runs as a **Railway cron job** — the process starts on
each schedule tick, runs the scrape to completion, and exits. No resident
daemon, no `node-cron`.

1. **Create a new service** pointing at this repo.
2. **Leave Root Directory blank** — the Dockerfile uses the repo root as its
   build context so it can copy `src/db/schema.ts` into the image.
3. **Set the Dockerfile Path** to `services/itchio-scraper/Dockerfile`
   (also set in `railway.toml`).
4. **Cron schedule** is configured in `railway.toml` via `cronSchedule`
   (daily 00:00 UTC). Override in the Railway dashboard under Settings →
   Cron Schedule if you want a different cadence. Note that a `railway
redeploy` of a cron service only re-arms the schedule; to force an
   immediate run, use the dashboard's run button (or the GraphQL
   `deploymentRestart` mutation).
5. **Environment variables** — see [`.env.example`](./.env.example). Minimum:
   - `DATABASE_URL` — reference the Railway Postgres service variable

## Running locally

```bash
cd services/itchio-scraper
bun install
cp .env.example .env
# edit .env — point DATABASE_URL at a local or staging DB

bun run start
```

## Historical backfill

`bun run backfill` walks `/jams/past/sort-date` (~420 pages, back to 2014) and
ingests every jam not yet persisted — metadata + entries, with zero-rating
entries pre-marked so the nightly cron only drains rate pages that can actually
rank. It is idempotent and resumable: a jam only counts as done once its
entries landed, so interrupting mid-run (SIGTERM, crash, redeploy) is safe —
re-running continues where it left off. Knobs: `BACKFILL_MAX_JAMS` (cap per
invocation), `BACKFILL_OLDEST` (ISO date cutoff), `BACKFILL_DELAY_MS`
(default 400). Sizing expectations are documented in
[the deep-dive doc](../../docs/research/itch-scraper-browserless-deep-dive.md)
(~3-6 h for metadata + entries; rankings drain over subsequent cron runs).

**Running it on Railway** (recommended for the full multi-hour pull):

1. Create a new service in the project pointing at this repo.
2. In service Settings, set **Config file path** to
   `services/itchio-scraper/railway.backfill.toml` (leave Root Directory
   blank, same as the main scraper service).
3. Add `DATABASE_URL` referencing the database service's variable.
4. Deploy. The hourly cron doubles as the resume mechanism — interrupted or
   partial runs continue on the next tick, ticks during an active run are
   SKIPPED, and once everything is ingested each tick is a ~5-minute no-op.
5. Watch progress via the run logs (`[backfill] page N done — ingested=…`),
   then **delete the service** once it reports nothing left to ingest.

## Behavior & guarantees

- **Upserts, not inserts.** Each run updates existing rows keyed on
  `jam_id` / `entry_id`, so the tables always reflect the latest itch.io
  state rather than accumulating snapshots.
- **Rate-page scrape is gated.** Scraping every submission's rate page is
  expensive (~1400 requests for Brackeys Jam), so by default
  (`SCRAPE_ENTRY_RESULTS=after-voting`) it only runs once the jam has moved
  into the `over` status, and each entry is only scraped until
  `results_fetched_at` is populated.
- **Polite pacing.** Every itch.io request flows through one global pacer
  (`MIN_REQUEST_INTERVAL_MS` between any two requests, shared by all
  workers); a 429/503 pauses the whole pool for `Retry-After` (or
  `RATE_LIMIT_COOLDOWN_MS` when itch doesn't send one).
- **Nothing is ever deleted.** A jam or entry that 404s or drops off itch is
  stamped `missing_since` instead of being removed. Missing jams keep being
  retried for `MISSING_RETRY_DAYS`, then drop out of the resync bucket; a
  later successful scrape (or an entry being listed again) clears the stamp.
  Slugs reused by a new jam get their displaced row parked under
  `<slug>--displaced-<jam_id>`. Review what's accumulated with:

  ```sql
  SELECT slug, missing_since FROM itch.jams WHERE missing_since IS NOT NULL;
  SELECT entry_id, jam_id, missing_since FROM itch.jam_entries WHERE missing_since IS NOT NULL;
  SELECT slug, first_seen_at FROM itch.missing_jams; -- never-persisted 404s from the backfill walk
  ```

- **Exit code reflects success.** If any jam fails the process exits
  non-zero, so Railway's run logs flag failed ticks clearly.
