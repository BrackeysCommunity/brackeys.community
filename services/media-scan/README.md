# Media Scan — Railway Deployment

Resident Railway worker that fingerprints and scores every image the platform
shows, from one BullMQ queue, with one model loaded once:

- **jam entry covers** and **jam banners** the crawler observed (plan 22's
  detectors: dHash into `itch.entry_scans` / `itch.jam_scans`, the SigLIP2
  embedding probe for NSFW, exact + near-hash theft matching within the
  corpus) — flags land in `social.entry_flags` for `/admin?section=entry-flags`;
- **member uploads** — team avatars and banners, collab post images, project
  covers, profile-project images, team showcase covers — read straight from
  the private MinIO bucket, scored the same way, with flags in
  `social.image_flags` for `/admin?section=image-flags`.

Nothing here acts on an itch entry. Uploads are the one exception: a score at
or above `UPLOAD_QUARANTINE_THRESHOLD` hides the image pending review
(detached from its owner row and moved under the bucket's `quarantine/`
prefix, which the public `/images/` route refuses) and notifies the uploader.
Dismiss from `/admin` puts it back; confirm deletes it. The mechanics live in
`src/lib/image-quarantine.ts`, shared with the app and DB-tested there.

## Where jobs come from

| Job         | Producer                                                     | Latency              |
| ----------- | ------------------------------------------------------------ | -------------------- |
| `entry`     | the crawler, on insert or cover-id change; the reconciler    | seconds after a tick |
| `banner`    | the crawler, on banner-id change; the reconciler             | seconds after a tick |
| `upload`    | the web app's upload handlers (`uploadImageToStorage`)       | seconds after upload |
| `rescan`    | `/admin` (Rescan on an upload flag)                          | seconds              |
| `reconcile` | this worker, repeatable on `RECONCILE_CRON` and once at boot | hourly               |

Job ids carry the image identity (`entry-<id>-<itch image id>`), so the same
cover enqueued by the crawler every half hour collapses to one job and a
replaced cover is a new one. The reconciler is the floor: the DB predicates in
`src/jobs/selectors.ts` decide what is due — never scanned, older detector,
cover image changed, embedding missing or from a different encoder, a drift
revisit due, an upload row still pending — bounded by `SCAN_BATCH`,
`SCAN_REVISIT_BATCH`, `BANNER_BATCH`, `UPLOAD_BATCH` so a detector bump
drains at a chosen pace. A job lost to a Redis restart is found within the
hour; losing Redis degrades to hourly, never below.

## Pacing

Every itch request rides the per-host pacer in `src/lib/itch-pacer.ts`,
shared with the crawler through Redis: one budget for `itch.io` (data.json),
one for `img.itch.zone` (covers, banners). Any number of processes draw on
the same budget, so there is no cron stagger to keep and a second instance
of this worker against the same Redis is the multi-machine backfill recipe.
If Redis is unreachable the pacer paces locally for 30s and tries again.

## Concurrency

`SCAN_CONCURRENCY` jobs at once (default 3). Entry jobs take the jam's
advisory lock (same `"SCAN"` namespace as before) plus an in-process mutex,
because the near matcher's comparison pool must hold a jam's predecessors —
a jam is scanned one entry at a time however many workers or instances
there are. A job that can't get its jam within two minutes is deferred and
retried, not failed.

## Schema

No migrations of its own. `itch.entry_scans`, `itch.jam_scans`,
`media.image_scans`, `social.entry_flags`, `social.image_flags`, and
`itch.tier_heartbeats` are all in the main drizzle schema (`src/db/schema.ts`).
The worker writes one heartbeat row (`media-scan-reconcile`) per reconcile.

## Railway setup

1. **Create a new service** pointing at this repo.
2. **Leave Root Directory blank** — the Dockerfile builds from the repo root so
   it can copy `src/db/schema.ts` and the shared `src/lib` modules.
3. **Config file path** `services/media-scan/railway.toml` (resident,
   `restartPolicyType = "ALWAYS"`).
4. **Variables** — see [`.env.example`](./.env.example): `DATABASE_URL`,
   `REDIS_URL` (same Dragonfly as Web and the crawler), and the `MINIO_*`
   trio Web has. Everything else has defaults.
5. The image bakes the SigLIP2 fp16 weights (~750 MB) at build time via
   `src/scan/warm-nsfw.ts`; size the container for the model resident
   (measure RSS after the first tick — plan 24's open question 2).

## Running locally

```bash
cd services/media-scan
bun install
cp .env.example .env   # DATABASE_URL, REDIS_URL, MINIO_*

bun run start          # the worker
bun run reconcile      # one reconcile pass, then exit
bun run rescore        # DB-only re-score after a probe retrain
bun test src
```

From the repo root, `bun run railway:media-scan` runs the worker against
staging's DB and Redis (the multi-machine drain: it takes jobs alongside the
deployed instance, and the advisory locks keep jams whole).
