# itch.io Crawler — Railway Deployment

One resident Railway service that scrapes itch.io jam data (metadata,
entries, per-submission rankings), keeps linked members' itch libraries in
sync, and syncs it all into the main brackeys Postgres DB.

Every scrape tier runs from **one priority loop** in one process
([src/crawler.ts](./src/crawler.ts), [src/jobs/tier-loop.ts](./src/jobs/tier-loop.ts)).
They were five cron services (plus a sixth for the library sync) until plan
27: the itch rate pacer was per-process, so the only thing keeping six
processes from multiplying the request rate was that their cron minutes
didn't overlap. Now the pacer lives in Redis, per host, shared with the
media-scan worker, and the tiers can interleave however they like.

| Tier             | Priority | Interval             | Works                                                                                   |
| ---------------- | -------- | -------------------- | --------------------------------------------------------------------------------------- |
| **live**         | 1        | 15 min               | jams that have started and haven't finished (~285): jam page + entries.json             |
| **jam-backfill** | 2        | 15 min               | DB-only: linked members' jam entries → `profile_projects`, converged onto projects      |
| **discovery**    | 3        | 4 h                  | the listing walks, jams we don't hold, upcoming refresh                                 |
| **results**      | 4        | 6 h                  | ranking collection for finished jams (backlog-driven)                                   |
| **library**      | 5        | 1 h                  | linked accounts: identity refresh, API library sync, restricted probe + jam-banner scan |
| **sweep**        | 6        | continuous when idle | the jam-id sweep, until the cursor reaches the frontier; then 6-hourly                  |

Each turn runs the highest-priority due tier under a **chunk** deadline
(`CRAWLER_CHUNK_MINS`, default 10) rather than a cron slot. A tier that
finishes its list is re-armed on its interval; one that stops at the chunk
stays due and continues next turn — unless something higher-priority became
due meanwhile, which then runs first. That is what makes live's 15-minute
interval honest: results can hold hours of backlog and never delay live by
more than one chunk.

The loop persists each tier's `nextRunAt` in `itch.tier_heartbeats` along
with `last_ok_at` / `last_error`, so a redeploy resumes the cadence instead of
firing everything at boot, and a stale heartbeat is the alert the crons never
had (plan 27's cheapest deliverable — the one that would have caught the June
outage).

Image moderation is **not** here anymore. The crawler hands what it observes
— a new entry, an entry whose cover image changed, a jam whose banner changed
— to the media-scan worker as a job (`src/queue.ts`, fire-and-forget), and
[services/media-scan](../media-scan/README.md) does the fetching, hashing, and
scoring with the model resident. Without `REDIS_URL` the crawler emits
nothing; the worker's hourly reconciler derives the same set from the DB.

## What it scrapes

Everything is fetched with plain HTTP (`fetch` + cheerio) — every page the
crawler reads is fully server-rendered by itch.io and served without a JS
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
| `itch.game_jam_scans` (no itch traffic)     | jam slugs read off members' own game pages by the library tier — the only route for a jam itch's listings omit (see discovery, below)                                                                                                                              |
| `/jam/{slug}`                               | title, numeric jam id, hosts, hashtag, status, start/end/voting-end dates, banner, entries count, ratings count, description HTML                                                                                                                                  |
| `/jam/{jamId}/entries.json`                 | every submission's id, rating count, coolness, rate URL, submission timestamp, game metadata (title, short text, cover, platforms), author and contributors — undocumented API per [itch.io thread](https://itch.io/t/1487695/solved-any-api-to-fetch-jam-entries) |
| `/jam/{slug}/rate/{gameId}`                 | per-criterion rank, adjusted score, raw score (only available on the rate page — not in the API)                                                                                                                                                                   |
| `api.itch.io/profile`, `/profile/games`     | a linked member's identity and game library (library tier, bearer token)                                                                                                                                                                                           |
| `<user>.itch.io/<game>` (HEAD / GET)        | the restricted-visibility probe, and the "Submission to <jam>" banner scan                                                                                                                                                                                         |

### How each tier picks its jams

Every selector lives in [src/jobs/selectors.ts](./src/jobs/selectors.ts), in one
place because they are the seam between the tiers — a jam that falls out of
every tier stops being scraped at all.

**live** ([sync-live.ts](./src/jobs/sync-live.ts)) — jams with
`status != 'over'` whose `starts_at` has passed (a null `starts_at` counts as
started). Jam page + `entries.json` each. The entries fetch is the whole point:
it is the only capture of submissions added since the last turn, and a missed
window while a jam is open is not recoverable later.

Keyed on dates rather than `status`, which matters in two directions. A jam
whose stored status lags reality is still selected and gets corrected by the
re-scrape — that is what `resync-stale` had to exist to do when the tick keyed
off status alone. And a jam whose deadline just passed is still selected, so
the run that flips it to `over` is the same one that hands it to the results
tier.

Ordered **staleest-first**, which is what makes a truncated turn self-healing.
itch's rate limiter does cut runs short (a 429 costs a pool-wide cooldown),
and unordered, the next turn would re-read the same arbitrary prefix while the
tail was never synced at all. Ordering by `scraped_at` sends the jams just
synced to the back of the queue, so every open jam is visited before any is
visited twice.

**discovery** ([discover.ts](./src/jobs/discover.ts)) — walks the listings,
then syncs the slugs **not already in `itch.jams`**, in this order:

1. `/jams/in-progress` — a jam we've never seen that is _already_ running is
   accruing submissions right now, so it should reach the live tier's set this
   turn rather than next.
2. `/jams/upcoming` — newly announced jams.
3. `/search?q=brackeys&type=jams` — historical Brackeys jams (brackeys-1 …
   brackeys-15) the first time we see them, then never again.
4. `itch.game_jam_scans` — jams a member's own game page says it was submitted
   to, written by the library tier's page scan. itch's listings are **not** a
   complete index of past jams: the 2014 cohort (Candy Jam is `jam_id` 1) is in
   none of them, and spot checks find ordinary older jams missing too. For a
   jam a member actually entered, their game page is the only way in. Slugs in
   `itch.missing_jams` are excluded — this set is permanent, so a dead slug
   would otherwise be re-fetched every turn forever.
5. `/jams/past/sort-date`, walked until `ENDED_LOOKBACK_DAYS` — the
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
round-robins. Ingestion runs first: a jam we don't hold is invisible in the
product, while a stale upcoming jam is merely slightly wrong.

**results** ([collect-results.ts](./src/jobs/collect-results.ts)) — jams at
`status = 'over'` that still have entries with `results_fetched_at IS NULL`,
newest first. These cost no metadata requests; `syncEntryResults` reads the bulk
`/jam/{slug}/results` listing. Terminal jams with everything collected are in no
tier at all, so we don't burn cycles re-scraping historical submissions.

**library** and **jam-backfill** ([library-sync.ts](./src/jobs/library-sync.ts))
— what `services/itchio-library-sync` did as a 15-minute cron, split by whether
it touches itch. The DB-only jam backfill keeps the 15-minute cadence (it is
a join from `itch.jam_entries` to `linked_accounts`; itch's API has no jam
endpoints). The itch-facing half runs hourly: refresh each linked account's
identity (renames change every game URL), sync its library from
`api.itch.io`, then anonymously probe every published game page — a 404 means
Restricted on itch, which the API can't express — and read the page's
"Submission to <jam>" button into `itch.game_jam_scans` for discovery.
`LINKED_ACCOUNTS_ENC_KEY` must equal the Web service's: the tier decrypts the
tokens the app sealed.

**sweep** ([sweep-ids.ts](./src/jobs/sweep-ids.ts)) — the walk that finds jams
itch.io never lists; see below.

The `/jams` calendar page is intentionally **not** scraped — it only encodes
dates as CSS pixels and gives us nothing the per-jam page doesn't already
provide.

### Pacing

Every itch request goes through [src/http.ts](./src/http.ts), which builds the
shared client from `src/lib/itch-http.ts` over one pacer per host
(`src/lib/itch-pacer.ts`): `itch.io` (HTML pages, entries.json, data.json,
the game-page probes), `img.itch.zone` (covers — the media-scan worker's
traffic, on the same budget), and `api.itch.io` (the library tier's bearer
calls). With `REDIS_URL` set the pacer is a Lua-reserved slot in Redis, so
this process and the media-scan worker draw on one budget per host; a 429
arms a pool-wide cooldown that escalates per strike. Without Redis, or while
it is unreachable, the pacer paces this process alone and says so once.

## Schema

The crawler does **not** manage its own migrations. Everything it writes lives
in the main brackeys drizzle schema (`src/db/schema.ts`): the `itch.*` tables,
`user.profile_projects` / `user.linked_accounts` (library tiers), and the
canonical `project.*` rows the shared `src/lib/project-sync.ts` mints.

## Railway setup

Create **one service** pointing at this repo:

1. **Root Directory blank** — the Dockerfile uses the repo root as its build
   context so it can copy `src/db/schema.ts` and the shared `src/lib` modules.
2. **Config file path** [`services/itchio-scraper/railway.toml`](./railway.toml)
   — resident (`restartPolicyType = "ALWAYS"`, `bun run start`). No cron
   schedule: the loop is the scheduler.
3. **Variables**: `DATABASE_URL`, `REDIS_URL` (the same Dragonfly Web and
   media-scan use), `LINKED_ACCOUNTS_ENC_KEY` (equal to Web's). Everything else
   is optional — see [`.env.example`](./.env.example).

A redeploy sends SIGTERM: the tier in flight finishes its current jam, the
process exits, and the new container resumes every tier from its persisted
`nextRunAt` and progress (`scraped_at`, `results_fetched_at`, the sweep
cursor).

The old per-tier services (live, discovery, results, scan, backfill) and
`itchio-library-sync` are retired by this one; delete them once it is running,
or they will scrape alongside it.

## Running locally

```bash
cd services/itchio-scraper
bun install
cp .env.example .env
# edit .env — point DATABASE_URL at a local or staging DB

bun run start      # the loop, every tier
bun run live       # one-shot: open jams
bun run discover   # one-shot: listings + new jams + upcoming refresh
bun run results    # one-shot: ranking collection
bun run library    # one-shot: jam backfill, then the itch-facing library sync
bun run sweep      # one-shot: id-space sweep
```

Bound a one-shot run so it doesn't walk the whole set — the deadline is
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
(default 400). It is a one-shot for a laptop now; the temporary Railway
service that ran it hourly is gone, and its second phase — the id sweep — is
the crawler's idle-time tier.

### The id sweep

The listing walk above can only ingest what itch **lists**, and its listings
are not a complete index of past jams. `/jams/past/sort-date` bottoms out at
~page 420 (September 2013) after ~21k jams, and jams missing from it are easy
to find: Candy Jam (`jam_id` 1) and the rest of the 2014 cohort appear in no
listing at all, and probing ids turns up ordinary 2016 and 2021 jams whose
pages scrape perfectly well.

So the sweep ([sweep-ids.ts](./src/jobs/sweep-ids.ts)) walks the id space
directly, whenever nothing more urgent is due. `/jam/{id}/entries.json` needs
no slug and settles an id in one request; a hit's payload carries the entries
_and_ the slug (inside each entry's rate URL), so the jam page is the only extra
fetch. Legacy raw-jam pages parse since [jam-page.ts](./src/scrape/jam-page.ts)
learned that layout.

Sizing, measured August 2026: **~178k probes**, ~17h of pacer time. Sampling
put the hit rate at 12/60 unheld ids below 20k and 4/120 above 240k, i.e.
**on the order of 8k jams we don't hold**.

| Knob                  | Default  | Why                                                                               |
| --------------------- | -------- | --------------------------------------------------------------------------------- |
| `SWEEP_INTERVAL_MINS` | 360      | once the cursor reaches the frontier, how often it trails the frontier up         |
| `SWEEP_FROM`          | 1        | floor for the cursor — raise it to skip ahead, lower it to re-probe a bad stretch |
| `SWEEP_GAP_START/END` | 20k/240k | the barren middle of the id space, skipped by default and logged when it is       |

Jam ids cluster below 20k and above 240k; we hold 3 rows across the 220k
between them and 60 random probes there found nothing, so sweeping it costs
another ~21h for a handful of jams. Set `SWEEP_GAP_END` equal to
`SWEEP_GAP_START` to sweep it anyway.

The cursor lives in `itch.scrape_cursors` and only moves forward. A jam with
**no entries** is invisible to this walk by construction — the probe is empty
either way, and with no entry there is no rate URL, so no slug, and `/jam/{id}`
404s. Those stay the listings' job.

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
`bun run drain` and `bun run resync`.) Set `REDIS_URL` too if you want the run
to share the deployed pacer's budget rather than pace itself.

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

Since the tier split, `resync` should rarely have anything to do: the live tier
selects on dates rather than `status`, so a jam carrying a stale status is
picked up and corrected within the interval. It's kept for forcing that
correction immediately, and as the fallback if the live tier is ever wedged.

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
- **Polite pacing.** Every itch request flows through one pacer per host,
  shared through Redis with the media-scan worker; a 429/503 pauses the whole
  pool for `Retry-After` (or an escalating cooldown starting at
  `RATE_LIMIT_COOLDOWN_MS` from the second consecutive strike).
- **A truncated turn loses nothing.** Both jam-syncing tiers select
  staleest-first and every tier persists progress as it goes, so a turn cut
  short by its chunk, a redeploy, or a rate-limit storm resumes at the tail
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
  SELECT tier, next_run_at, last_ok_at, last_error FROM itch.tier_heartbeats; -- the loop's health
  ```

- **Failures are retried once, then tolerated.** Whatever failed during a turn
  gets one more attempt at the end of it — almost every failure is itch
  rate-limiting a jam that goes through fine once the pacer has cooled off, so
  the retry costs one request per failure and usually clears the set. Anything
  still failing is logged and left to the next turn. A tier that _throws_ is
  backed off five minutes and recorded in `tier_heartbeats.last_error`; the
  loop itself never dies for one tier's fault.
