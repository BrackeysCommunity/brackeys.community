# Build context = repo root (so we can read src/db/schema.ts).
# In Railway, leave "Root Directory" unset and set "Dockerfile Path" to
# services/itchio-scraper/Dockerfile.

FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY services/itchio-scraper/package.json ./services/itchio-scraper/package.json
RUN cd services/itchio-scraper && bun install --production=false

FROM oven/bun:1.3-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/services/itchio-scraper/node_modules ./services/itchio-scraper/node_modules
COPY services/itchio-scraper/package.json ./services/itchio-scraper/package.json
COPY services/itchio-scraper/tsconfig.json ./services/itchio-scraper/tsconfig.json
COPY services/itchio-scraper/src ./services/itchio-scraper/src

# The scraper imports the shared drizzle schema from the main app so that
# everything stays in a single source of truth under drizzle migrations.
COPY src/db/schema.ts ./src/db/schema.ts

WORKDIR /app/services/itchio-scraper
CMD ["bun", "run", "start"]
