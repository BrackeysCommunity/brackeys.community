# Deep dive: does the itch scraper need Browserless at all?

_Research date: 2026-08-01, following the June 17 → Aug 1 ingest outage post-mortem._

## Verdict

**No.** Every page the scraper touches is fully server-rendered and reachable with a
plain HTTP `fetch` — even when sent with our self-identifying bot user agent
(`brackeys-itchio-scraper/0.1`). The entire Browserless + puppeteer-core layer adds
cost, latency, and two outage classes (wedged Chromium, port drift) without adding any
capability we use.

## Evidence

| Target                                                                | Method tested       | Result                                                                                              |
| --------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `/jam/{slug}` (jam page)                                              | plain fetch, bot UA | 200; contains `jam_title_header`, `I.ViewJam` payload, `stat_box` — everything `jam-page.ts` parses |
| `/jam/{id}/entries.json`                                              | plain fetch, bot UA | 200 (779 KB for brackeys-15) — already fetched without a browser in production                      |
| `/jam/{slug}/rate/{gameId}`                                           | plain fetch, bot UA | 200; contains `ranking_results_table` — everything `rate-page.ts` parses                            |
| `/jams/upcoming`, `/jams/in-progress`, `/jams/past/sort-date`, search | plain fetch, bot UA | 200; same `.jam_grid_widget` markup the discovery parser expects                                    |
| Jam page network activity (real browser, devtools)                    | —                   | **Zero** XHR/JSON requests: the page is 100% server-rendered HTML                                   |

Proof at scale: during outage recovery we backfilled **435 jams (and ~large entry sets
via entries.json) with plain fetch and zero fetch failures** (see "Outage recovery"
below).

The scraper never used JS rendering anyway — `browser.ts` waits for
`domcontentloaded` and hands `page.content()` to cheerio. Chrome was acting as a
~2-second-per-page, 4-GB-resident HTTP client.

There is no official/private JSON API alternative for jam metadata or results:
`api.itch.io` covers only one's own games, there is no `results.json`, and the jam
page loads no data endpoints we could call directly. HTML parsing (+ `entries.json`)
is the right and only approach; it just doesn't need a browser to fetch the HTML.

## Recommended changes

1. **Replace `fetchHtml` with plain `fetch`** (keep the existing retry/backoff and
   429/503 handling, add 521 as transient). Delete `puppeteer-core`, the
   `BROWSERLESS_WS_ENDPOINT` config, and the Browserless service. Faster runs
   (~5-10x per page), one less always-on container, two fewer failure modes.
   Keep the honest bot UA; it is not blocked.
2. **Close the discovery gap**: discovery only reads `/jams/upcoming` + brackeys
   search, so any jam that first appears while already running (or during a scraper
   outage) is missed forever. Add `/jams/in-progress` (5 pages, 50 cells/page) and
   optionally a bounded walk of `/jams/past/sort-date` (end-date descending) back to
   the last successful run. This is what made outage recovery need manual backfill.
3. **Ops hygiene**:
   - `services/itchio-scraper/railway.toml` says `cronSchedule = "0 4 * * 1"` but the
     deployed service runs `0 0 * * *` (daily). Align the file with reality.
   - Do NOT set `PORT` on the Browserless service. The template runs Caddy listening
     on `BROWSER_PORT_PRIVATE` (3001) reverse-proxying to `127.0.0.1:$PORT` where
     browserless itself listens; overriding `PORT=3001` makes the two processes fight
     over the port and crash-loops the container (verified 2026-08-01).
   - Add failure alerting on the cron (it failed daily for six weeks unnoticed).
     Simplest: a Railway webhook/notifier on `CRASHED` deployments of `jam-scraper`.
4. Optional efficiency: tier the resync cadence (jams starting >30 days out don't
   need daily scrapes) if run length ever becomes a concern once results backlogs
   are drained.

## Risk notes

- Cloudflare could tighten bot rules later; today neither datacenter IPs (Railway,
  proven by `entries.json` in production) nor plain-fetch TLS fingerprints are
  challenged on these paths. If 403/challenge pages ever appear, re-introducing a
  browser fetcher is a contained change behind `fetchHtml`'s signature.
- Keep per-request pacing (~300-400 ms) and the existing 429 backoff; itch tolerates
  the current volume fine.
- **Rate limiting must be global, not per-request** (learned 2026-08-01): the first
  3,500-entry jam sustained ~8 req/s from 5 workers and tripped itch's limiter hard —
  per-request backoff only slowed the failing request while the pool kept feeding
  fresh attempts. All itch requests now flow through one shared pacer
  (`MIN_REQUEST_INTERVAL_MS`, default 350 ms ≈ max ~2.9 req/s) plus a pool-wide
  cooldown on 429/503 that honors `Retry-After` (fallback `RATE_LIMIT_COOLDOWN_MS`,
  default 60 s).

## Mass historical pull — sizing (researched 2026-08-01)

How far back we have data today: essentially **2026 only** (1,036 of 1,118 jams;
the rest are the Brackeys 2018-2026 backfill plus a few far-future joke jams).

How far back itch goes: `/jams/past/sort-date` is **not** meaningfully capped — it
spans **418 pages × 50 = ~20,900 public past jams**, date-sorted back to **Nov 2014**.
A full walk of it (slug + end date for every listed past jam) is ~420 requests ≈ 5
minutes. No jam-ID enumeration needed (that space is ~420k ids at ~5-10% hit rate —
viable but strictly worse).

Measured plain-fetch throughput: ~1.8 req/s sequential (~560 ms/page, ~18 KB); jam
sync (page + entries.json) ≈ 1-2 s. Sampled 2023-era jams: ~11 entries/jam average,
~87% of entries have ≥1 rating.

Budget for pulling all ~19,800 missing historical jams:

| Phase                                  | Requests  | Wall time (2-4 req/s, polite) |
| -------------------------------------- | --------- | ----------------------------- |
| Discovery (listing walk)               | ~420      | ~5 min                        |
| Jam metadata + entries.json            | ~40k      | **~3-6 h**                    |
| Rate-page results (rated entries only) | ~200-260k | **~15-35 h**                  |

Storage impact: well under 1 GB (entries ≈ +200 MB, results ≈ +300 MB, jams ≈ +80 MB).

Verdict: **yes — the plain-fetch refactor makes a mass historical pull practical.**
Through Browserless (~2 s/page, wedge-prone) the results phase alone would have been
5+ days of Chrome sessions. Recommended shape: a resumable one-off backfill job
(cursor over the sort-date walk) for metadata + entries, letting the nightly cron's
pending-results bucket drain rankings over subsequent runs; pre-mark
`results_fetched_at` on entries with `rating_count = 0` (they can't rank) to skip
~13% of rate fetches. Pace at ≤4 req/s with the existing 429 backoff.

## Outage recovery record (2026-08-01)

- Root cause: the Browserless container had run untouched since 2026-04-22 and was
  wedged — idling at 4.2 GB RSS with zero sessions, and every Chromium launch died
  instantly (`TargetCloseError` in its logs), so Caddy relayed a non-101 response to
  each scraper handshake ("Expected 101 status code") from June 17 onward. Fixed by
  redeploying the service (fresh container). A brief detour of pinning `PORT=3001`
  was wrong (see above) and was reverted the same day.
- Backfilled via plain fetch from a one-off script: 190 running/upcoming jams missed
  during the outage + 245 jams that ended during it (with entries, so the cron's
  pending-results bucket scrapes their rankings).
- Catch-up cron run force-started via GraphQL `deploymentRestart` (a `railway
redeploy` of a cron service only re-arms the schedule; it does not run it).
