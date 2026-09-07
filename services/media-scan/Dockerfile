# Build context = repo root (so we can read src/db/schema.ts and the shared
# src/lib modules). In Railway, leave "Root Directory" unset and set
# "Dockerfile Path" to services/media-scan/Dockerfile.

FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY services/media-scan/package.json ./services/media-scan/package.json
RUN cd services/media-scan && bun install

FROM oven/bun:1.3-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/services/media-scan/node_modules ./services/media-scan/node_modules
COPY services/media-scan/package.json ./services/media-scan/package.json
COPY services/media-scan/tsconfig.json ./services/media-scan/tsconfig.json
COPY services/media-scan/src ./services/media-scan/src

# Shared with the main app so schema, the queue contract, the itch pacer and
# HTTP client, the quarantine mechanics, and the notification write path
# have one source of truth. This list is the service's whole view of the
# repo root: anything src/ reaches through `../../../src/` has to be here or
# the container dies on start.
COPY src/db/schema.ts ./src/db/schema.ts
COPY src/db/service-client.ts ./src/db/service-client.ts
COPY src/lib/service-config.ts ./src/lib/service-config.ts
COPY src/lib/service-telemetry.ts ./src/lib/service-telemetry.ts
COPY src/lib/itch-pacer.ts ./src/lib/itch-pacer.ts
COPY src/lib/itch-http.ts ./src/lib/itch-http.ts
COPY src/lib/media-scan-queue.ts ./src/lib/media-scan-queue.ts
COPY src/lib/image-quarantine.ts ./src/lib/image-quarantine.ts
COPY src/lib/notify-core.ts ./src/lib/notify-core.ts
COPY src/lib/notification-copy.ts ./src/lib/notification-copy.ts

# The copied root files under /app/src import bare specifiers (posthog-node,
# drizzle-orm), which resolve up from /app — not from the service dir.
RUN ln -s /app/services/media-scan/node_modules /app/node_modules

WORKDIR /app/services/media-scan

# Bake the model weights into the image (~750MB into .model-cache): the
# worker loads them once at boot, and a Hugging Face outage must not strip
# scores from a deploy.
RUN bun run src/scan/warm-nsfw.ts

CMD ["bun", "run", "start"]
