# Notifications Worker — Railway Deployment

Long-lived Railway service that consumes BullMQ jobs enqueued by the main
brackeys web app. It runs notification side-effects (in-app row enrichment,
SSE broadcast in Phase 9, email delivery in Phase 10) and the weekly digest
cron.

## Why a separate service

Web requests stay fast: they do one synchronous `notifications` insert plus
one `queue.add()` call (sub-millisecond). Anything slow — email rendering,
push delivery, digest aggregation — runs in this worker so it never blocks
a user-facing request and can be scaled independently.

## Schema

The worker does **not** manage its own migrations. The `user.notifications`
table lives in the main brackeys drizzle schema (`src/db/schema.ts`) and is
applied via the same `drizzle-kit` flow as the rest of the app.

## Queues

| Queue           | Job names                        | Source                                     |
| --------------- | -------------------------------- | ------------------------------------------ |
| `notifications` | `side_effects`, `weekly_digests` | Web app `notify()` helper; repeatable cron |
| `email`         | (default)                        | The notifications worker (Phase 10)        |

## Railway setup

1. **Create a new service** pointing at this repo.
2. **Leave Root Directory blank** — the Dockerfile uses the repo root as its
   build context so it can copy `src/db/schema.ts` into the image.
3. **Set the Dockerfile Path** to `services/notifications-worker/Dockerfile`
   (also set in `railway.toml`).
4. **Long-lived, not cron** — the `restartPolicy=ALWAYS` keeps the workers
   resident so they can pick up jobs the moment they're enqueued. Weekly
   digests are scheduled via a BullMQ repeatable job registered at boot.
5. **Environment variables** — see [`.env.example`](./.env.example):
   - `DATABASE_URL` — reference the Railway Postgres service variable
   - `REDIS_URL` — reference the Railway Redis service variable

## Running locally

```bash
cd services/notifications-worker
bun install
cp .env.example .env
# point REDIS_URL at your local or Railway-private Redis

bun run start
```

You should see `[worker:notifications] ready` and
`[worker:email] ready`. Triggering any `notify()` call from the web app
(e.g. by responding to someone else's collab post in dev) will produce a
`[side_effects] processed` log line within ~100ms.
