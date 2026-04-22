# itch.io Scraper — Railway Deployment

Railway cron job that scrapes itch.io jam data (metadata, entries,
per-submission rankings) and syncs it into the main brackeys Postgres DB.

## What it scrapes

| Source                                  | Access                                                                                                               | Captured fields                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/jams/upcoming` (page 1)               | puppeteer (Browserless)                                                                                              | jam slugs for forward discovery                                                                                                                             |
| `/search?q=brackeys&type=jams` (page 1) | puppeteer (Browserless)                                                                                              | jam slugs for one-time Brackeys backfill                                                                                                                    |
| `/jam/{slug}`                           | puppeteer (Browserless)                                                                                              | title, numeric jam id, hosts, hashtag, status, start/end/voting-end dates, banner, entries count, ratings count, description HTML                           |
| `/jam/{jamId}/entries.json`             | plain `fetch` (undocumented API per [itch.io thread](https://itch.io/t/1487695/solved-any-api-to-fetch-jam-entries)) | every submission's id, rating count, coolness, rate URL, submission timestamp, game metadata (title, short text, cover, platforms), author and contributors |
| `/jam/{slug}/rate/{gameId}`             | puppeteer (Browserless)                                                                                              | per-criterion rank, adjusted score, raw score (only available on the rate page — not in the API)                                                            |

### How slugs are chosen each tick

The sync set is the union of three buckets:

1. **Upcoming discovery** — every slug on page 1 of `/jams/upcoming`. Always
   synced so we catch newly-announced jams as soon as they appear.
2. **Brackeys backfill** — every slug on page 1 of
   `/search?q=brackeys&type=jams` **that isn't already in `itch.jams`**.
   Brings in historical Brackeys jams (brackeys-1 … brackeys-15) the first
   time we see them, then drops out of the bucket forever.
3. **Persisted re-sync** — every slug already in `itch.jams` where the jam
   isn't "done" yet. Specifically: `status != 'over'` **or** at least one of
   its entries still has `results_fetched_at IS NULL`. Jams in terminal
   state with all rate pages collected are skipped, so we don't burn cycles
   re-scraping hundreds of historical Brackeys submissions every Monday.

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
and `atlas.hcl` (`schemas = [..., "itch"]`). To materialize them:

```bash
# From repo root, after pulling this change:
bun atlas:diff            # generates drizzle/00XX_*.sql and refreshes atlas.sum
bun atlas:apply           # apply locally
bun railway:atlas:apply   # apply in prod
```

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
   (default `0 4 * * 1` — Mondays 04:00 UTC). Override in the Railway
   dashboard under Settings → Cron Schedule if you want a different cadence.
5. **Environment variables** — see [`.env.example`](./.env.example). Minimum:
   - `DATABASE_URL` — reference the Railway Postgres service variable
   - `BROWSERLESS_WS_ENDPOINT` — the Browserless v2 websocket URL, usually
     `wss://browserless.railway.internal?token=…` via Railway's private
     networking

## Running locally

```bash
cd services/itchio-scraper
bun install
cp .env.example .env
# edit .env — you can point BROWSERLESS_WS_ENDPOINT at a local
# `docker run -p 3000:3000 ghcr.io/browserless/chromium:latest`

bun run start
```

## Behavior & guarantees

- **Upserts, not inserts.** Each run updates existing rows keyed on
  `jam_id` / `entry_id`, so the tables always reflect the latest itch.io
  state rather than accumulating snapshots.
- **Rate-page scrape is gated.** Scraping every submission's rate page is
  expensive (~1400 requests for Brackeys Jam), so by default
  (`SCRAPE_ENTRY_RESULTS=after-voting`) it only runs once the jam has moved
  into the `over` status, and each entry is only scraped until
  `results_fetched_at` is populated.
- **Puppeteer connects, never launches.** We use `puppeteer-core` +
  `puppeteer.connect({ browserWSEndpoint })` so no Chromium is bundled in
  the image. Disconnect on exit — never close the shared Browserless
  browser.
- **Network is trimmed.** Images/fonts/media are blocked per page to keep
  each scrape fast and cheap.
- **Exit code reflects success.** If any jam fails the process exits
  non-zero, so Railway's run logs flag failed ticks clearly.
