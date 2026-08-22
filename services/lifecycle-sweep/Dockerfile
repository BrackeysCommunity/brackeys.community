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
# constants the write paths stamp with. None of these import the app's `db`
# or its `@/` alias — that's what keeps them copyable. This list is the
# service's whole view of the repo root: anything `src/index.ts` reaches
# through `../../../src/` has to be here or the container dies on start.
COPY src/db/schema.ts ./src/db/schema.ts
COPY src/db/service-client.ts ./src/db/service-client.ts
COPY src/lib/service-config.ts ./src/lib/service-config.ts
COPY src/lib/bull-redis.ts ./src/lib/bull-redis.ts
COPY src/lib/collab-lifecycle.ts ./src/lib/collab-lifecycle.ts
COPY src/lib/notify-core.ts ./src/lib/notify-core.ts
COPY src/lib/notification-copy.ts ./src/lib/notification-copy.ts
COPY src/lib/jam-watch.ts ./src/lib/jam-watch.ts
COPY src/lib/jam-watch-sweep.ts ./src/lib/jam-watch-sweep.ts
COPY src/lib/service-telemetry.ts ./src/lib/service-telemetry.ts

RUN ln -s /app/services/lifecycle-sweep/node_modules /app/node_modules

WORKDIR /app/services/lifecycle-sweep
CMD ["bun", "run", "start"]
