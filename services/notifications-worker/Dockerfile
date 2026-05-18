# Build context = repo root (so we can read src/db/schema.ts).
# In Railway, leave "Root Directory" unset and set "Dockerfile Path" to
# services/notifications-worker/Dockerfile.

FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY services/notifications-worker/package.json ./services/notifications-worker/package.json
RUN cd services/notifications-worker && bun install

FROM oven/bun:1.3-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/services/notifications-worker/node_modules ./services/notifications-worker/node_modules
COPY services/notifications-worker/package.json ./services/notifications-worker/package.json
COPY services/notifications-worker/tsconfig.json ./services/notifications-worker/tsconfig.json
COPY services/notifications-worker/src ./services/notifications-worker/src

# The worker imports the shared drizzle schema, notification-copy
# helpers, and unsubscribe-token helper from the main app so that
# schema, default prefs, email headline text, and one-click-unsub
# token logic all live in a single source of truth.
COPY src/db/schema.ts ./src/db/schema.ts
COPY src/lib/notification-copy.ts ./src/lib/notification-copy.ts
COPY src/lib/unsubscribe.ts ./src/lib/unsubscribe.ts
COPY src/emails ./src/emails

WORKDIR /app/services/notifications-worker
CMD ["bun", "run", "start"]
