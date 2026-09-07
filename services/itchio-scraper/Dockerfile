# Build context = repo root (so we can read src/db/schema.ts and the shared
# src/lib modules). In Railway, leave "Root Directory" unset and set
# "Dockerfile Path" to services/itchio-scraper/Dockerfile.

FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY services/itchio-scraper/package.json ./services/itchio-scraper/package.json
RUN cd services/itchio-scraper && bun install

FROM oven/bun:1.3-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/services/itchio-scraper/node_modules ./services/itchio-scraper/node_modules
COPY services/itchio-scraper/package.json ./services/itchio-scraper/package.json
COPY services/itchio-scraper/tsconfig.json ./services/itchio-scraper/tsconfig.json
COPY services/itchio-scraper/src ./services/itchio-scraper/src

# Shared with the main app so schema, the itch pacer and HTTP client, the
# media-scan queue contract, and the canonical-project writes (the library
# tier creates placements, and a placement with no project row behind it is
# a project page that doesn't exist) all have one source of truth. This list
# is the service's whole view of the repo root: anything src/ reaches through
# `../../../src/` has to be here or the container dies on start.
COPY src/db/schema.ts ./src/db/schema.ts
COPY src/db/service-client.ts ./src/db/service-client.ts
COPY src/lib/service-config.ts ./src/lib/service-config.ts
COPY src/lib/service-telemetry.ts ./src/lib/service-telemetry.ts
COPY src/lib/itch-pacer.ts ./src/lib/itch-pacer.ts
COPY src/lib/itch-http.ts ./src/lib/itch-http.ts
COPY src/lib/media-scan-queue.ts ./src/lib/media-scan-queue.ts
COPY src/lib/project-sync.ts ./src/lib/project-sync.ts
COPY src/lib/project-taxonomy.ts ./src/lib/project-taxonomy.ts
COPY src/lib/itch-urls.ts ./src/lib/itch-urls.ts
COPY src/lib/member-name.ts ./src/lib/member-name.ts
COPY src/lib/itchio.ts ./src/lib/itchio.ts
COPY src/lib/token-crypto.ts ./src/lib/token-crypto.ts

# The copied root files under /app/src import bare specifiers (posthog-node,
# drizzle-orm), which resolve up from /app — not from the service dir.
RUN ln -s /app/services/itchio-scraper/node_modules /app/node_modules

WORKDIR /app/services/itchio-scraper

# The resident crawler. The one-shot tiers (`bun run live` etc.) remain for
# local runs; nothing in production should start one alongside the loop.
CMD ["bun", "run", "start"]
