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
