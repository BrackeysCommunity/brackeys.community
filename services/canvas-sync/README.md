# canvas-sync

The live canvas relay. Editors with `canvases-multiplayer` on connect here over a
websocket instead of saving through `canvas.saveCanvas`; the service relays their
edits to each other (Hocuspocus 4.7 on Bun) and merges the live doc into
`canvas.canvas_docs` a couple of seconds after the last change.

```
browser ──getCanvasSyncToken──▶ web app (access check, mints a 60s token)
   │
   └──wss://…  token ─────────▶ canvas-sync ──merge on store──▶ Postgres
                                   ▲    ▲
          revoke / apply (Redis) ──┘    └── extension-redis: relay between instances
```

## What it does

- **Auth.** `onAuthenticate` verifies the token from `src/lib/canvas/token.ts`
  (HMAC-SHA256, `CANVAS_SYNC_SECRET`, shared with the web app). The token names one
  document (`canvas:<id>`) and an access level; a `read` token connects read-only,
  so nothing it sends is applied or relayed. Deleted canvases are refused. `note:`
  documents have names already but are refused for now.
- **Store.** Debounced 2s (at most every 10s while edits keep coming). One
  transaction: make sure the `canvas_docs` row exists, lock it, fold what's stored
  into the live doc, check the caps (5 MB, 2,000 cards), take an hourly version of
  what was stored (same rule as the web app), write the state, `byte_size` and
  `last_edited_*`. The JSON Canvas snapshot is rebuilt at most every 30s per canvas
  and on the store that runs as the last person leaves.
- **Caps.** A message over 1 MB closes the sender's session with `4413` (a sync
  step 2, which carries a whole offline backlog, may be as large as a canvas: 5 MB,
  but only the first on a connection);
  the editor also refuses to send a single change over 1 MB, since one over Bun's
  10 MB frame cap is dropped without a close code. More than
  60 messages/s (burst 200) with `4429`; the 51st connection on a canvas and the 11th
  for one person are refused with `4429` (the per-person count spans instances
  through Redis and fails open). A seat is reserved before the Redis read, and an
  instance writes its count (reservations included) before reading the others', so
  a burst of connects can't slip past either cap, even split across instances; a
  burst over the cap may refuse a few that would have fit, and they get in on the
  retry. A seat whose socket closes before it is set up, or whose canvas fails to load, frees at once. One socket gets one session per
  canvas: session-keyed names (`canvas:<id>\0<session>`) are closed with `4403`. A store over a cap is refused, Postgres keeps what
  it had, and everyone on that canvas is closed with `4413`; the editor stops
  reconnecting on `4413`. Between stores a live doc is measured each time 5 MB of
  writes arrive for it, and one found over the cap is closed the same way.
- **Revoke.** The web app publishes `{canvasId?, userId?}` on
  `<env>:canvas-sync:revoke` when access changes (canvas deleted, member removed or
  left, team archived/hidden/deleted, ban, account deletion). Matching connections
  close with `4403`; the editor then re-reads the canvas. Each instance remembers a
  revoke for a token's lifetime (60s, plus 2s for clock skew) and refuses any token
  minted before it, so a removed member can't reconnect with the token they hold.
  The web app also leaves a tombstone (`<env>:canvas-sync:revoked:<canvasId>:<userId>`,
  either part empty, value the revoke time in ms, 62s TTL), read on each connect, so
  an instance that started after the publish refuses those tokens too (fails open;
  the first reads after a boot wait up to 1s for the Redis client).
  The check runs again once a connection is set up and on each message, which
  catches a revoke that lands while a connect is still authenticating.
- **Apply.** After a server-side write (`saveCanvas`, `restoreCanvasVersion`) the
  web app publishes `{canvasId}` on `<env>:canvas-sync:apply`; if the canvas is open
  here, the stored state is loaded into the live doc so editors see it.
- **Redis is optional at runtime.** It carries revokes, applies, the per-person
  cap and the relay between instances (extension-redis, without its store lock:
  every store merges under a row lock, so two instances storing one canvas can't
  lose edits). While Redis is down or hung, documents still load, edit and store as
  if this were the only instance; once it's back, every loaded document announces
  its state again so instances catch up. Revokes published during the outage are
  lost, so the store also stops writing into a canvas that has been trashed.
- **Shutdown.** SIGTERM stops accepting, closes every session, runs every pending
  store, waits for the docs to unload (up to `SHUTDOWN_TIMEOUT_MS`), then exits.
  `railway.toml` sets `drainingSeconds = 30` so Railway waits for that.

Close codes (in `src/lib/canvas/sync-channels.ts`; Hocuspocus carries them at the
front of the close reason): `4401` bad token (retry with a fresh one), `4403`
revoked, `4413` too large (stop), `4429` rate or caps (back off).

## Environment

| Variable                   | Notes                                                                            |
| -------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`             | The app database (same one the web app uses).                                    |
| `REDIS_URL`                | Optional locally. Needed wherever revokes, applies or a second instance matter.  |
| `CANVAS_SYNC_SECRET`       | At least 16 characters; identical on Web.                                        |
| `PORT`                     | Railway sets it; 1234 locally.                                                   |
| `RAILWAY_ENVIRONMENT_NAME` | Railway sets it; prefixes every Redis key and channel (`staging:canvas-sync:…`). |
| `POSTHOG_KEY`              | Optional; errors and the minute metrics go to PostHog.                           |
| `INSTANCE_ID`              | Optional; defaults to hostname-pid. Names this instance in Redis.                |
| `STORE_DEBOUNCE_MS`        | Optional override of the 2s store debounce.                                      |
| `SHUTDOWN_TIMEOUT_MS`      | Optional, default 25000: how long SIGTERM waits for stores.                      |

Web needs `CANVAS_SYNC_SECRET` and `CANVAS_SYNC_URL` (`wss://…`, returned with each
token, so there's no build-time variable). With either unset, or the flag off, the
editor stays on the solo save.

## Run it locally

```sh
cd services/canvas-sync
bun install
DATABASE_URL=postgres://… CANVAS_SYNC_SECRET=local-dev-secret-123 bun run start
# web app .env: CANVAS_SYNC_SECRET=local-dev-secret-123 CANVAS_SYNC_URL=ws://localhost:1234
```

Then turn `canvases-multiplayer` on for yourself in PostHog (or flip its default in
`src/lib/flags.ts` locally) and open a canvas in two browsers.

## Health and metrics

- `GET /health` → `{"documents": n, "connections": n}`. Railway's healthcheck.
- Once a minute: a `canvas_sync_metrics` PostHog event and a `[metrics] {…}` log
  line with documents, connections, messages/s, stores (count, failures, refused,
  p50/p99 ms), merge and snapshot p99, largest stored state, revocations, applies,
  refusals by reason (auth, size, rate, caps), event-loop lag p99 and RSS.
- Event-loop lag p99 should stay under 20ms. If `merge_p99_ms` or
  `snapshot_p99_ms` stay above ~15ms on real canvases, move merge and snapshot to a
  worker (see `test/LOAD.md`).

## Revoking by hand

Publish on the environment's channel, e.g. from `redis-cli` against the same Redis:

```sh
PUBLISH staging:canvas-sync:revoke '{"canvasId":"<id>","userId":"<user>"}'  # one person, one canvas
PUBLISH staging:canvas-sync:revoke '{"canvasId":"<id>"}'                    # everyone on a canvas
PUBLISH staging:canvas-sync:revoke '{"userId":"<user>"}'                    # one person everywhere
```

The log prints `[revoke] closed n connection(s)`. Access itself is decided at token
mint, so also fix whatever granted it, or they'll reconnect. A hand-published revoke
leaves no tombstone; add one with `SET staging:canvas-sync:revoked:<id>:<user> <ms> PX 62000`
if an instance may start within the next minute.

## Tests

```sh
bun test                       # unit tests; integration suites skip loudly without a DB
test/scratch-pg.sh start <dir> # throwaway Postgres 16 with the app's migrations; prints the URL
CANVAS_SYNC_TEST_DATABASE_URL=… bun test
CANVAS_SYNC_TEST_REDIS_URL=…   # enables the Redis suites when a Redis is available
bun run test/load.ts           # manual load check; results in test/LOAD.md
bunx tsc --noEmit
```

The root `vp check` doesn't typecheck this service; run its own `tsc`. Before a
deploy that touches a shared file, `vp test src/lib/__tests__/service-image-manifest.test.ts`
and a replica of the image layout (copy the Dockerfile's COPY list and this
directory into an empty tree, `bun install --frozen-lockfile`, symlink
`node_modules` to the root, `bun run src/index.ts`, `curl /health`).

**Two Yjs copies locally.** The shared `src/lib/canvas/*` modules resolve `yjs`
from the repo root and the service resolves its own, so only bytes cross between
them (the image has one copy through the `node_modules` symlink). Never hand a
Hocuspocus document to a shared helper.

## Staging setup (by hand)

1. Generate a secret (`openssl rand -base64 48`) and set `CANVAS_SYNC_SECRET` on
   staging **Web** and on the new service.
2. Create the Railway service `canvas-sync` in staging from this repo: Root
   Directory blank, config file `services/canvas-sync/railway.toml`, tracking
   `main`. Variables: `DATABASE_URL` (reference the app DB Web uses),
   `REDIS_URL=${{Dragonfly.DRAGONFLY_URL}}`, `CANVAS_SYNC_SECRET`, the PostHog key.
   Leave `PORT` to Railway.
3. Add a public domain and the Cloudflare DNS record for the staging sync host (SSL
   mode Full). Set Web's `CANVAS_SYNC_URL=wss://<that host>`.
4. Check Dragonfly's pub/sub with the service's commands (`SUBSCRIBE`, `PUBLISH`,
   `PUBSUB NUMSUB`); no Lua is used. From a Railway shell:
   `redis-cli -u $REDIS_URL PUBSUB NUMSUB staging:canvas-sync:revoke` should print 1
   per running instance.
5. Deploy with the flag off and check `/health`. Then turn on `canvases-multiplayer`
   for staff in PostHog and smoke test:
   - two browsers editing one canvas;
   - a redeploy mid-edit (nothing lost, both browsers reconnect);
   - with two replicas (or during the deploy overlap), two browsers on different
     instances see each other's edits live, before any reconnect;
   - removing a teammate while they're on a team canvas (their tab drops within a
     second; the others stay);
   - the per-person cap across instances (11 tabs of one account, split across
     replicas, opened one by one: the 11th is refused).

   These last three need a Redis, which the local test runs don't have; with one,
   `CANVAS_SYNC_TEST_REDIS_URL=… CANVAS_SYNC_TEST_DATABASE_URL=… bun test test/redis.test.ts`
   covers them too.
