# Build context = repo root (so we can read src/db/schema.ts).
# In Railway, leave "Root Directory" unset and set "Dockerfile Path" to
# services/itchio-library-sync/Dockerfile.

FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY services/itchio-library-sync/package.json ./services/itchio-library-sync/package.json
RUN cd services/itchio-library-sync && bun install

FROM oven/bun:1.3-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/services/itchio-library-sync/node_modules ./services/itchio-library-sync/node_modules
COPY services/itchio-library-sync/package.json ./services/itchio-library-sync/package.json
COPY services/itchio-library-sync/tsconfig.json ./services/itchio-library-sync/tsconfig.json
COPY services/itchio-library-sync/src ./services/itchio-library-sync/src

# The sweep imports the shared drizzle schema from the main app so that
# everything stays in a single source of truth under drizzle migrations.
COPY src/db/schema.ts ./src/db/schema.ts

WORKDIR /app/services/itchio-library-sync
CMD ["bun", "run", "start"]
