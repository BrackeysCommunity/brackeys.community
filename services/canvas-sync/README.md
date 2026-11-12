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

The service hosts document kinds by name prefix (`src/kinds.ts`): `canvas:<id>`,
`scene:<project>.<key>`, `project:<project>` and `asset:<project>.<key>`, each
with its own access check, load, store, migration and limits; an instance hosts
the kinds whose stores it was started with. A token names its document and its
kind, or is project-scoped (below); any other prefix is refused at
`onAuthenticate` with `4403`. Everything below is the canvas kind; scenes are in
[Scenes](#scenes), project registries and asset docs in
[Projects and assets](#projects-and-assets).

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
revoked, `4409` seed-stale (the client's copy came from another seed, the row
was reseeded: the server refuses it before syncing, and the editor reopens its
project session from the server's state), `4413` too large (stop), `4429` rate
or caps (back off).

## Scenes

Hosted scene documents for `@jams/engine` (`src/scene/`), co-edited the way
canvases are. Rows live in `canvas.scene_docs`, keyed by the scene id
`<project>.<key>` (each part an engine id; a scene hosted before projects is
`<game>.<name>`, its game being its project), with `project_id` naming the
`engine_projects` row.

- **Tokens.** The canvas token with `k: "scene"`, `f` (the scene format version
  of the engine the client runs, `SCENE_FORMAT_VERSION`) and `l` (its collab
  layout, `COLLAB_LAYOUT_VERSION`), minted by `getSceneSyncToken` for staff only,
  or a project-scoped token of the scene's project. A canvas token can't open a
  scene, nor a scene token a canvas (`4401`); a token without `f` is refused
  (`4401`). The scene must exist (`4403` otherwise).
- **Seeding.** Only the server fills a new doc, in `onLoadDocument`: from the
  row's `seed` (the JSON the web app stored at `createHostedScene`, migrated),
  else an empty scene of the id's name. The seed is written deterministically
  (the writing client id and every key derive from the scene and its content),
  so two instances seeding one scene at once write the same items and the
  merged doc holds one copy. The seeded state is stored at once.
- **Versions.** A doc older than this instance's format is migrated in place at
  load (keys kept: named entities by id, bulk entries by position) and stored.
  A client whose `f` differs from the doc's `meta.schemaVersion`, or whose `l`
  differs from its `meta.layout` (a token without `l` counts as layout 1),
  connects read-only and gets a stateless
  `{"type":"scene-read-only","reason":…,"schemaVersion":…,"layout"?:…}` (`layout`
  only when that is what differs): `engine-outdated` (reload to update) or
  `server-outdated` (this instance can't migrate the doc to the client's version
  yet). An instance older than a stored doc serves it unchanged and leaves its
  snapshot alone.
- **Layout 1 → 2.** A doc stored at collab layout 1 holds its prefabs in its own
  `prefabs` map; at load (`migrateLayout`, through
  `src/lib/scene/project-bytes.ts`) each one the project has no live prefab
  for becomes a prefab asset (key = id, at `<scene's folder>/prefabs/<id>.json`,
  or `prefabs/<id>.json` for a scene the registry doesn't list), one the
  project holds with the same body is kept, and one with another body keeps the
  project's and logs `prefab-diverged` in the scene's migration entry. Writes run
  in an order a crash can't lose: the registry first (its duties make the new
  rows), then the prefab docs (seeded deterministically), then the scene with
  its map cleared and `meta.layout` set. A prefab entry whose doc was never
  seeded takes the scene's copy, so a migration cut short finishes on the next
  load. A layout-1 scene with prefabs and no project row is refused (`4403`) and
  left as stored; a quota that refuses the new prefabs closes it with `4413`.
- **Layout 2 → 3.** Layout 3 keeps the layout's own record keys under `@`
  names: an entity's or instance's order key is `@z` (layout 2's `z`) and a
  bulk entry's key `@bulk` (`bulk`), so a draw-order field `z` is the entity's
  own; a `keyed` collection's entries in a declarative asset doc likewise hold
  `@z`. Scene docs add an `assets` map; prefab docs add `params`, `overrides`,
  `assets` and `instances`. At load the layout step runs before the format
  migration: a layout-2 scene renames every record's keys in one `migration`
  transaction, keeping every entity's and instance's key, and needs no project
  (a layout-1 scene goes 1 → 3 in one step, its prefabs moved as above). A
  prefab doc or an engine kind's declarative doc stored at layout 2 is lifted
  the same way at load (`migrateAssetLayoutState`) and stored with a fresh
  snapshot; a game's kinds are left to its clients. Snapshots and the
  registry's reads lift a stored layout-2 doc in a scratch doc first. A client
  with `l` below 3 connects read-only with `engine-outdated`.
- **Store.** Same debounce as canvases. Every store merges the live doc into
  what's stored through a scratch `Y.Doc` under the row lock, then folds back
  into the live doc whatever was stored that it lacked. The canonical JSON
  (`formatScene`) and its `sceneHash` are rebuilt on a worker thread, at most
  every 30s per scene and on the store that runs as the last person leaves.
- **Caps** (`src/lib/scene/limits.ts`): 2 MB of state, 10,000 entities, 512 KB
  per message after the first sync. Over either cap: `4413`, as for canvases.
- **Revoke.** `{"sceneId":"<id>","userId"?:"<user>"}` on the same revoke
  channel; tombstones are kept under `revoked:scene:<id>:<user>`. A `{userId}`
  revoke covers scenes too. An instance from before scenes reads a
  `{sceneId,userId}` revoke as `{userId}` and closes that person's sockets
  everywhere; they reconnect.
- **Not in 0.1.** Agent clients (`vp run scene apply --live`, MCP) get no hosted
  tokens and stay on the dev server; getting hosted edits back into git (an
  export or `scene pull` from the snapshot) comes later.

## Projects and assets

A hosted `@jams/engine` project is one registry doc and one doc per asset that
isn't a blob (`services/canvas-sync/src/engine/`): `project:<project>`
(`engine_projects.state`), its scenes (`scene:<project>.<key>`, above) and every other doc kind
(`asset:<project>.<key>`, `engine_asset_docs`, prefabs included). Blobs live in
`engine_blobs` and the content store; the registry holds their hashes.

- **Tokens.** `k: "project"` or `k: "asset"`, always with `l`. A project token
  with `s: "project"` (what `getProjectSyncToken` and the agent token exchange
  mint) opens every doc of its project, each under its own kind; one without it
  opens only the registry, and an asset token only its one doc. Anything outside
  the project is `4401` ("token is for another document"). A client whose `l`
  differs from the docs' layout connects read-only with a stateless
  `{"type":"layout-read-only","reason":…,"layout":…}` (scenes send their own
  notice, above).
- **Registry.** The `engine_projects` row must exist and not be deleted (`4403`).
  A new doc is seeded with `meta` only (the web app writes a created project's
  first state into the row). Every store merges into what's stored through a
  scratch doc and then does the one writer's duties in one `repair`
  transaction: path and id repairs, rows for new doc entries (checked against
  the `QuotaPolicy`, unlimited by default; a refused one goes to the trash with
  `quota-exceeded`), a live hash the project's blobs lack goes back to an
  earlier one (`hash-mismatch`), and a trashed entry an open doc names comes
  back (`asset-in-use`). The project's other docs ask for that last check after
  they load or store.
- **Asset docs.** The row comes first (the registry's duties, or the web app's
  bundle import, make it, with the asset's file as its `seed`). Only the server
  seeds a new doc: `meta` from the row and the content from the seed, laid out
  by the kind (a prefab as the prefab doc codec writes one), deterministically.
  Stores merge as scenes do. Docs of the engine's own kinds (prefabs and the
  declarative ones) keep their canonical text in `snapshot` and its SHA-256 in
  `content_sha256`; a game's kinds snapshot client-side.
- **Caps** (`src/limits.ts`, `src/lib/scene/limits.ts`): the registry 2 MB of
  state and 256 KB per message; an asset doc what its kind's `limits` name, else
  1 MB and 256 KB, prefabs also 10,000 children; no kind past 5 MB, 1 MB a
  message or 100,000 items. Over a cap: `4413`.
- **Revoke.** `{"projectId":"<id>","userId"?:"<user>"}` closes that person's (or
  everyone's) connections to every doc of the project; tombstones are kept under
  `revoked:project:<id>:<user>`, and a token minted before it is refused on any
  of the project's docs.

## The collector

Once a day at 03:30 UTC (`src/engine/collector.ts`, a timer in this process)
the collector cleans up hosted games' storage, one project at a time:

1. **Releases** beyond the 10 newest, unpinned by a channel or a jam and
   older than 14 days: `collected_at` set, `manifest` and file rows dropped,
   an audit row (`collect`, system). The record stays.
2. **Orphan release files:** `engine_release_objects` no release file row and
   no open upload lists, stored more than 24 hours ago.
3. **Blobs** nothing references: the registry (the live doc if this instance
   holds it, else the row) and every kept release's snapshot are what keep a
   blob. Referenced ones get `last_referenced_at` = now; unreferenced ones go
   after 30 quiet days.
4. **Uploads** expired and uncommitted (their files go with step 2 a day on).
5. **Deleted projects** 30 days after `deleted_at`: every object under
   `engine-assets/<project>/` and `engine-releases/<project>/` and every
   object its rows name, then the row (the tables cascade).

Each run plans everything first and logs every deletion (`[collector] would
delete …` or `[collector] deleting …`), then ends with counts and bytes per
step in the log and in PostHog (`engine_collector.run`), and the heartbeat row
`itch.tier_heartbeats` / `engine-collector` (`last_error` names projects that
failed; one failure never stops the run). Objects go before their rows, so a
run that stops halfway leaves at worst a row naming a missing object, which the
next run clears.

- **Report mode is the default.** `ENGINE_COLLECTOR_MODE=report` deletes
  nothing: it logs the plan and only stamps `last_referenced_at` on blobs still
  in use. Set `delete` once a report run's log has been read.
- **Without the bucket** (`MINIO_*` unset) releases and expired uploads are
  still collected in `delete` mode; every object deletion, and the row behind
  it, is only reported.
- **One runner:** with `REDIS_URL` the run takes
  `<prefix>:engine:collector:lock` (`SET NX EX 3600`), so of several replicas
  one runs; the lock lapses after its hour. Without Redis the instance runs alone.
- **Off on production** until hosted games open there, as the web app's guard.

## Environment

| Variable                                                                 | Notes                                                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | The app database (same one the web app uses).                                                             |
| `REDIS_URL`                                                              | Optional locally. Needed wherever revokes, applies or a second instance matter.                           |
| `CANVAS_SYNC_SECRET`                                                     | At least 16 characters; identical on Web.                                                                 |
| `PORT`                                                                   | Railway sets it; 1234 locally.                                                                            |
| `RAILWAY_ENVIRONMENT_NAME`                                               | Railway sets it; prefixes every Redis key and channel (`staging:canvas-sync:…`).                          |
| `POSTHOG_KEY`                                                            | Optional; errors and the minute metrics go to PostHog.                                                    |
| `INSTANCE_ID`                                                            | Optional; defaults to hostname-pid. Names this instance in Redis.                                         |
| `STORE_DEBOUNCE_MS`                                                      | Optional override of the 2s store debounce.                                                               |
| `SHUTDOWN_TIMEOUT_MS`                                                    | Optional, default 25000: how long SIGTERM waits for stores.                                               |
| `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` | The web app's uploads bucket, for the collector. Optional: without them it only reports object deletions. |
| `ENGINE_COLLECTOR_MODE`                                                  | `report` (default: log the plan, delete nothing) or `delete`.                                             |

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
bun test                       # unit tests and the scene suites; Postgres suites skip loudly without a DB
test/scratch-pg.sh start <dir> # throwaway Postgres 16 with the app's migrations; prints the URL
CANVAS_SYNC_TEST_DATABASE_URL=… bun test
CANVAS_SYNC_TEST_REDIS_URL=…   # enables the Redis suites when a Redis is available
CANVAS_SYNC_REQUIRE_INTEGRATION=1 # what CI sets: a suite that would skip fails instead
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
