# Build context = repo root (so we can read src/db/schema.ts).
# In Railway, leave "Root Directory" unset and set "Dockerfile Path" to
# services/notifications-worker/Dockerfile.

FROM oven/bun:1.4-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61 AS deps
WORKDIR /app
# The lockfile ships with the manifest so the image resolves the same
# tree the repo pins; without it the build picks whatever the registry
# serves that day, which the base image pin does nothing to constrain.
COPY services/notifications-worker/package.json services/notifications-worker/bun.lock ./services/notifications-worker/
RUN cd services/notifications-worker && bun install --frozen-lockfile

FROM oven/bun:1.4-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61 AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/services/notifications-worker/node_modules ./services/notifications-worker/node_modules
COPY services/notifications-worker/package.json ./services/notifications-worker/package.json
COPY services/notifications-worker/tsconfig.json ./services/notifications-worker/tsconfig.json
COPY services/notifications-worker/src ./services/notifications-worker/src

# The worker imports the shared drizzle schema, notification-copy
# helpers, and unsubscribe-token helper from the main app so that
# schema, default prefs, email headline text, and one-click-unsub
# token logic all live in a single source of truth. This list is the
# service's whole view of the repo root: anything src/ reaches through
# `../../../src/` has to be here or the container dies on start.
COPY src/db/schema.ts ./src/db/schema.ts
COPY src/db/service-client.ts ./src/db/service-client.ts
COPY src/lib/service-config.ts ./src/lib/service-config.ts
COPY src/lib/bull-redis.ts ./src/lib/bull-redis.ts
COPY src/lib/notify-core.ts ./src/lib/notify-core.ts
COPY src/lib/notification-copy.ts ./src/lib/notification-copy.ts
COPY src/lib/profanity.ts ./src/lib/profanity.ts
# The lifecycle sweep takes a collab post's Discord mirror down when it
# expires. Dependency-free on purpose — see the module's header.
COPY src/lib/discord-message-delete.ts ./src/lib/discord-message-delete.ts
COPY src/lib/format-time.ts ./src/lib/format-time.ts
COPY src/lib/og/palette.ts ./src/lib/og/palette.ts
COPY src/lib/unsubscribe.ts ./src/lib/unsubscribe.ts
COPY src/lib/email.ts ./src/lib/email.ts
COPY src/lib/email-utm.ts ./src/lib/email-utm.ts
COPY src/emails ./src/emails
COPY src/lib/service-telemetry.ts ./src/lib/service-telemetry.ts
# The lifecycle sweep (tasks/lifecycle-sweep.ts): the same day-count
# constants the app's write paths stamp with, the jam-watch pass, and the
# read-notification retention pass.
COPY src/lib/collab-lifecycle.ts ./src/lib/collab-lifecycle.ts
COPY src/lib/jam-watch.ts ./src/lib/jam-watch.ts
COPY src/lib/jam-watch-sweep.ts ./src/lib/jam-watch-sweep.ts
COPY src/lib/notification-retention.ts ./src/lib/notification-retention.ts
COPY src/lib/project-orphan-sweep.ts ./src/lib/project-orphan-sweep.ts
COPY src/lib/website-verification.ts ./src/lib/website-verification.ts
COPY src/lib/website-verification-check.ts ./src/lib/website-verification-check.ts
COPY src/lib/website-verification-sweep.ts ./src/lib/website-verification-sweep.ts

RUN ln -s /app/services/notifications-worker/node_modules /app/node_modules

WORKDIR /app/services/notifications-worker
CMD ["bun", "run", "start"]
