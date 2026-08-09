# itch.io Scraper — Railway Deployment

Railway cron jobs that scrape itch.io jam data (metadata, entries,
per-submission rankings) and sync it into the main brackeys Postgres DB.

The scrape runs as **three independent cron services**, split by how
perishable their work is. They build the same image from the same Dockerfile
and share one config module and one set of scrapers — only the entrypoint and
the schedule differ.

| Tier          | Schedule        | Measured tick  | Command            | Works                                                        |
| ------------- | --------------- | -------------- | ------------------ | ------------------------------------------------------------ |
| **live**      | `:00` / `:30`   | 8–9 min        | `bun run live`     | jams that have started and haven't finished (~285)           |
| **discovery** | 4-hourly, `:20` | ~1–2 min       | `bun run discover` | the four listing walks, jams we don't hold, upcoming refresh |
| **results**   | 6-hourly, `:40` | backlog-driven | `bun run results`  | ranking collection for finished jams                         |

Live is the only tier with a meaningful runtime, and it drives the schedule:
a full pass over all ~285 open jams takes 8–9 minutes (including one itch 429
and its 60s pool cooldown), which fits the half-hour slot with room to spare
and leaves `:20` clear for discovery. Running it faster than every 30 minutes
means moving discovery — at `*/15` the live ticks occupy `:00-:09`, `:15-:24`,
`:30-:39`, `:45-:54` and `:20` collides.

They were one nightly tick until the coupling became the problem: ranking
collection is unbounded in size and worthless to hurry (a finished jam's scores
never change), while re-syncing open jams is small, bounded, and the only thing
that captures new submissions. Sharing a schedule meant the least urgent work
set the cadence for the most urgent, and every open jam waited up to 24 hours
for a refresh.

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

### How each tier picks its jams

Every selector lives in [src/jobs/selectors.ts](./src/jobs/selectors.ts), in one
place because they are now the seam between three services — a jam that falls
out of every tier stops being scraped at all.

**live** ([sync-live.ts](./src/jobs/sync-live.ts)) — jams with
`status != 'over'` whose `starts_at` has passed (a null `starts_at` counts as
started). Jam page + `entries.json` each. The entries fetch is the whole point:
it is the only capture of submissions added since the last tick, and a missed
window while a jam is open is not recoverable later.

Keyed on dates rather than `status`, which matters in two directions. A jam
whose stored status lags reality is still selected and gets corrected by the
re-scrape — that is what `resync-stale` had to exist to do when the tick keyed
off status alone. And a jam whose deadline just passed is still selected, so
the run that flips it to `over` is the same one that hands it to the results
tier, within an hour of the jam finishing rather than at the next midnight.

Ordered **staleest-first**, which is what makes a truncated tick self-healing.
itch's rate limiter does cut runs short (a 429 costs a 60s pool-wide cooldown),
and unordered, the next tick would re-read the same arbitrary prefix while the
tail was never synced at all. Ordering by `scraped_at` sends the jams just
synced to the back of the queue, so every open jam is visited before any is
visited twice.

**discovery** ([discover.ts](./src/jobs/discover.ts)) — walks all four
listings, then syncs the slugs **not already in `itch.jams`**, in this order:

1. `/jams/in-progress` — a jam we've never seen that is _already_ running is
   accruing submissions right now, so it should reach the live tier's set this
   tick rather than next.
2. `/jams/upcoming` — newly announced jams.
3. `/search?q=brackeys&type=jams` — historical Brackeys jams (brackeys-1 …
   brackeys-15) the first time we see them, then never again.
4. `/jams/past/sort-date`, walked until `ENDED_LOOKBACK_DAYS` — the
   outage-recovery walk. Jams created _and_ finished between successful runs
   are invisible to every other selector forever (as happened in the June 2026
   outage).

Persisted jams are skipped here: open ones belong to the live tier, and
upcoming ones are covered by the round-robin below.

Then it refreshes `DISCOVERY_UPCOMING_LIMIT` (default 50)
announced-but-not-started jams, staleest-first. These are the complement of the
live tier's set within the non-terminal jams, and the reason discovery refreshes
anything at all: an upcoming jam's dates and description do get edited, and
nothing else would notice until the jam started. They're cheap but numerous
(~205, some starting years out) and none of it is perishable, so the pool
round-robins — a full turnover roughly every 17 hours for ~300 requests a day,
against ~10k to refresh all of them hourly. Ingestion runs first: a jam we
don't hold is invisible in the product, while a stale upcoming jam is merely
slightly wrong.

**results** ([collect-results.ts](./src/jobs/collect-results.ts)) — jams at
`status = 'over'` that still have entries with `results_fetched_at IS NULL`,
newest first. These cost no metadata requests; `syncEntryResults` reads the bulk
`/jam/{slug}/results` listing. Terminal jams with everything collected are in no
tier at all, so we don't burn cycles re-scraping historical submissions.

The `/jams` calendar page is intentionally **not** scraped — it only encodes
dates as CSS pixels and gives us nothing the per-jam page doesn't already
provide.

### Why the schedules are staggered

The itch.io rate pacer (`MIN_REQUEST_INTERVAL_MS`) is **per-process**. Three
services running concurrently would triple the request rate itch sees, which
the pacer has no way to know about. So the tiers run at `:00`, `:20`, and `:40`,
and each carries a `*_DEADLINE_MINS` that bounds its run well inside its slot.

Stopping at a deadline is always free. Every tier's progress is persisted —
`scraped_at` for the two jam-syncing tiers, `results_fetched_at` per entry for
results — so the next tick resumes from it rather than restarting. Railway also
skips a cron tick while the previous run of _that same service_ is still going,
so a slow tier starves only itself.

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

Each tier is a **Railway cron job** — the process starts on each schedule tick,
runs to completion, and exits. No resident daemon, no `node-cron`. All three
build the same image from the same Dockerfile; only the config file differs.

Create **three services**, all pointing at this repo, each with:

1. **Root Directory blank** — the Dockerfile uses the repo root as its build
   context so it can copy `src/db/schema.ts` into the image.
2. **Config file path** set to the tier's toml:
   - [`services/itchio-scraper/railway.live.toml`](./railway.live.toml)
   - [`services/itchio-scraper/railway.discovery.toml`](./railway.discovery.toml)
   - [`services/itchio-scraper/railway.results.toml`](./railway.results.toml)

   Each pins its own `startCommand` and `cronSchedule`. Override a schedule in
   the dashboard under Settings → Cron Schedule if needed, but keep the stagger.

3. **`DATABASE_URL`** referencing the database service's variable. Everything
   else is optional — see [`.env.example`](./.env.example). The tiers read one
   shared config, so a single shared variable group works.

Note that a `railway redeploy` of a cron service only re-arms the schedule; to
force an immediate run, use the dashboard's run button (or the GraphQL
`deploymentRestart` mutation).

**Two traps when creating these services**, both of which produce a service that
builds green and never runs:

- **`cronSchedule` in the toml does not arm the scheduler.** Railway's cron
  scheduler reads the _service-instance_ field, not the deployment manifest. A
  service whose schedule comes only from config-as-code shows
  `nextCronRunAt: null` and simply never fires. Set the schedule on the service
  too (dashboard → Settings → Cron Schedule), matching the toml. Verify with
  `nextCronRunAt` — if it's null, the cron is not armed, whatever the toml says.
- **Setting the config file path after creating the service is too late for the
  first build.** Creating a repo-linked service triggers a deploy immediately,
  before `railwayConfigFile` is applied, so that build uses Railpack and ignores
  the toml entirely — including `startCommand`, which leaves it running as a
  resident service rather than a cron. Set the config file path, then trigger a
  fresh deploy and confirm the manifest reports
  `builder: DOCKERFILE` and the right `startCommand`.

There is no combined entrypoint and no default tier — the image's `CMD` fails
with a usage message if a service is deployed without a `startCommand`. That's
deliberate: defaulting to one of the tiers would let a misconfigured service
quietly add a second scraper to itch's rate budget.

## Running locally

```bash
cd services/itchio-scraper
bun install
cp .env.example .env
# edit .env — point DATABASE_URL at a local or staging DB

bun run live       # open jams
bun run discover   # listings + new jams + upcoming refresh
bun run results    # ranking collection
```

Bound an exploratory run so it doesn't walk the whole set — the deadline is
checked before each jam, so a jam is never left half-written:

```bash
LIVE_DEADLINE_MINS=1 bun run live
```

## Historical backfill

`bun run backfill` walks `/jams/past/sort-date` (~420 pages, back to 2014) and
ingests every jam not yet persisted — metadata + entries, with zero-rating
entries pre-marked so the results tier only drains rate pages that can actually
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

## Draining the ratings backlog by hand

Two manual jobs work the `results_fetched_at IS NULL` backlog on demand, rather
than waiting for the six-hourly results tier. Both are resumable — progress is
persisted per entry, so an interrupted run loses nothing. From the repo root:

```bash
bun run railway:scraper:drain    # collect rankings for finished jams
bun run railway:scraper:resync   # unstick jams whose status is stale, then collect
```

(Each wraps `railway run --service TimescaleDB` and maps `DATABASE_PUBLIC_URL`
onto `DATABASE_URL`. Inside this directory the underlying scripts are
`bun run drain` and `bun run resync`.)

**`drain`** ([src/jobs/drain-results.ts](./src/jobs/drain-results.ts)) walks
jams already at `status = 'over'` that still have entries with no rankings and
pulls them off the bulk `/jam/{slug}/results` listing — one request per ~20
entries, falling back to per-entry rate pages for jams whose host never
published a results listing. No discovery, no jam-page or `entries.json`
refetch. Knobs: `DRAIN_MAX_JAMS`, `DRAIN_DEADLINE_MINS`, `DRAIN_DELAY_MS`,
`DRAIN_ORDER` (`newest` default, or `smallest` to clear the backlog count
fastest).

**`resync`** ([src/jobs/resync-stale.ts](./src/jobs/resync-stale.ts)) covers
what `drain` structurally cannot: jams whose stored `status` says unfinished
but whose dates say otherwise. `drain` never re-scrapes a jam page, so those
rows are invisible to it and their entries sit in the backlog uncollected. This
job re-scrapes the page (correcting the status) and drains that jam's rankings
in the same pass. Scoped to jams whose `voting_ends_at` — or `ends_at`, for
jams with no voting phase — has already passed. Knobs: `RESYNC_MAX_JAMS`,
`RESYNC_DELAY_MS`.

Since the split, `resync` should rarely have anything to do: the live tier
selects on dates rather than `status`, so a jam carrying a stale status is
picked up and corrected within the hour. It's kept for forcing that correction
immediately, and as the fallback if the live tier is ever wedged.

If a `results_fetched_at IS NULL` count looks large but `drain` reports nothing
to do, run `resync` and then re-check. A count that stays high after both is
expected and healthy: it's dominated by jams still taking submissions or still
in voting, including open-ended ones like `decadejam` (submissions until 2030)
and `never-ending-gamejam` (2099). Those have no final rankings to fetch and
drain on their own as voting closes.

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
  `RATE_LIMIT_COOLDOWN_MS` when itch doesn't send one). The pacer is
  **per-process**, so it only holds within one tier — the schedule stagger and
  the per-tier deadlines are what keep the _aggregate_ rate polite.
- **A truncated tick loses nothing.** Both jam-syncing tiers select
  staleest-first and every tier persists progress as it goes, so a run cut
  short by its deadline, a redeploy, or a rate-limit storm resumes at the tail
  rather than restarting at the head.
- **Nothing is ever deleted.** A jam or entry that 404s or drops off itch is
  stamped `missing_since` instead of being removed. Missing jams keep being
  retried for `MISSING_RETRY_DAYS`, then drop out of every tier's selector; a
  later successful scrape (or an entry being listed again) clears the stamp.
  Slugs reused by a new jam get their displaced row parked under
  `<slug>--displaced-<jam_id>`. Review what's accumulated with:

  ```sql
  SELECT slug, missing_since FROM itch.jams WHERE missing_since IS NOT NULL;
  SELECT entry_id, jam_id, missing_since FROM itch.jam_entries WHERE missing_since IS NOT NULL;
  SELECT slug, first_seen_at FROM itch.missing_jams; -- never-persisted 404s from the backfill walk
  ```

- **Failures are retried once, then tolerated.** Whatever failed during a tick
  gets one more attempt at the end of it — almost every failure is itch
  rate-limiting a jam that goes through fine once the pacer has cooled off, so
  the retry costs one request per failure and usually clears the set. Anything
  still failing is logged and left to the next tick, and the process **exits
  0**: a handful of refused jams is the steady state, not a broken tick, and
  failing the process for it only made every Railway run red. A thrown error
  still exits non-zero — that means the tick couldn't run at all, which is a
  real alert. The discovery tier retries a failed _listing walk_ immediately
  rather than at the end, since the rest of the tick is derived from it.
