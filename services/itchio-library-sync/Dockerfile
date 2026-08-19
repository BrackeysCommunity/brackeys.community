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
# everything stays in a single source of truth under drizzle migrations —
# and, for the same reason, the canonical-project writes: a placement this
# sweep creates has to get its `project.projects` row from the same code the
# app uses. `project-sync.ts` pulls in `project-taxonomy.ts`, `itch-urls.ts`,
# and `member-name.ts`, and `itchio.ts` is the shared API client; none of them
# imports the app's `db` or its `@/` alias.
COPY src/db/schema.ts ./src/db/schema.ts
COPY src/lib/project-sync.ts ./src/lib/project-sync.ts
COPY src/lib/project-taxonomy.ts ./src/lib/project-taxonomy.ts
COPY src/lib/itch-urls.ts ./src/lib/itch-urls.ts
COPY src/lib/member-name.ts ./src/lib/member-name.ts
COPY src/lib/itchio.ts ./src/lib/itchio.ts
COPY src/lib/token-crypto.ts ./src/lib/token-crypto.ts
COPY src/lib/service-telemetry.ts ./src/lib/service-telemetry.ts

# The copied root files under /app/src import bare specifiers (posthog-node,
# drizzle-orm), which resolve up from /app — not from the service dir.
RUN ln -s /app/services/itchio-library-sync/node_modules /app/node_modules

WORKDIR /app/services/itchio-library-sync
CMD ["bun", "run", "start"]
