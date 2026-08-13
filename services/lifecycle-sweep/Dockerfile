# Build context = repo root (so we can read src/db/schema.ts).
# In Railway, leave "Root Directory" unset and set "Dockerfile Path" to
# services/lifecycle-sweep/Dockerfile.

FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY services/lifecycle-sweep/package.json ./services/lifecycle-sweep/package.json
RUN cd services/lifecycle-sweep && bun install

FROM oven/bun:1.3-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/services/lifecycle-sweep/node_modules ./services/lifecycle-sweep/node_modules
COPY services/lifecycle-sweep/package.json ./services/lifecycle-sweep/package.json
COPY services/lifecycle-sweep/tsconfig.json ./services/lifecycle-sweep/tsconfig.json
COPY services/lifecycle-sweep/src ./services/lifecycle-sweep/src

# Shared with the main app so schema and lifecycle windows have one source
# of truth: the sweep reads the same drizzle tables and the same day-count
# constants the write paths stamp with. Neither file imports the app's `db`
# or its `@/` alias.
COPY src/db/schema.ts ./src/db/schema.ts
COPY src/lib/collab-lifecycle.ts ./src/lib/collab-lifecycle.ts
COPY src/lib/notify-core.ts ./src/lib/notify-core.ts
COPY src/lib/notification-copy.ts ./src/lib/notification-copy.ts

RUN ln -s /app/services/lifecycle-sweep/node_modules /app/node_modules

WORKDIR /app/services/lifecycle-sweep
CMD ["bun", "run", "start"]
