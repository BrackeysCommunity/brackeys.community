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

# The worker imports the shared drizzle schema from the main app so that
# everything stays in a single source of truth under drizzle migrations.
COPY src/db/schema.ts ./src/db/schema.ts

WORKDIR /app/services/notifications-worker
CMD ["bun", "run", "start"]
