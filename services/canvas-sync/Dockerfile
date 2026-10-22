# Build context = repo root (so we can read src/db/schema.ts and the shared
# src/lib modules). In Railway, leave "Root Directory" unset and set
# "Dockerfile Path" to services/canvas-sync/Dockerfile.

FROM oven/bun:1.4-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61 AS deps
WORKDIR /app
# The lockfile ships with the manifest so the image resolves the same
# tree the repo pins.
COPY services/canvas-sync/package.json services/canvas-sync/bun.lock ./services/canvas-sync/
RUN cd services/canvas-sync && bun install --frozen-lockfile

FROM oven/bun:1.4-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61 AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/services/canvas-sync/node_modules ./services/canvas-sync/node_modules
COPY services/canvas-sync/package.json ./services/canvas-sync/package.json
COPY services/canvas-sync/tsconfig.json ./services/canvas-sync/tsconfig.json
COPY services/canvas-sync/src ./services/canvas-sync/src

# Shared with the web app so the schema, the token, the channel names, the
# limits and the doc rules have one source of truth. This list is the
# service's whole view of the repo root: every file src/ reaches through
# `../../../src/` must be here, and none of them may import through `@/`
# (src/lib/__tests__/service-image-manifest.test.ts checks both).
COPY src/db/schema.ts ./src/db/schema.ts
COPY src/db/service-client.ts ./src/db/service-client.ts
COPY src/lib/service-config.ts ./src/lib/service-config.ts
COPY src/lib/service-telemetry.ts ./src/lib/service-telemetry.ts
COPY src/lib/canvas/limits.ts ./src/lib/canvas/limits.ts
COPY src/lib/canvas/token.ts ./src/lib/canvas/token.ts
COPY src/lib/canvas/sync-channels.ts ./src/lib/canvas/sync-channels.ts
COPY src/lib/canvas/json-canvas.ts ./src/lib/canvas/json-canvas.ts
COPY src/lib/canvas/doc-state.ts ./src/lib/canvas/doc-state.ts
COPY src/lib/canvas/state-write.ts ./src/lib/canvas/state-write.ts

# The copied root files import bare specifiers (yjs, drizzle-orm, zod,
# fractional-indexing, posthog-node), which resolve up from /app — not from
# the service dir. This also makes them share the service's one Yjs.
RUN ln -s /app/services/canvas-sync/node_modules /app/node_modules

WORKDIR /app/services/canvas-sync

CMD ["bun", "run", "start"]
