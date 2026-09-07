# Build context = repo root (so we can read the shared src/lib helpers).
# In Railway, leave "Root Directory" unset and set "Dockerfile Path" to
# services/discord-bot/Dockerfile.

FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY services/discord-bot/package.json ./services/discord-bot/package.json
RUN cd services/discord-bot && bun install

FROM oven/bun:1.3-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/services/discord-bot/node_modules ./services/discord-bot/node_modules
COPY services/discord-bot/package.json ./services/discord-bot/package.json
COPY services/discord-bot/tsconfig.json ./services/discord-bot/tsconfig.json
COPY services/discord-bot/src ./services/discord-bot/src

# The bot renders with the app's own presentation helpers so a jam phase,
# a rate string or a profile link reads the same in Discord as on the site.
# This list is the service's whole view of the repo root: anything src/
# reaches through `../../../src/` has to be here or the container dies on
# start. The public router is imported as a *type only* and is deliberately
# absent — the image must not be able to run it.
COPY src/lib/service-config.ts ./src/lib/service-config.ts
COPY src/lib/service-telemetry.ts ./src/lib/service-telemetry.ts
COPY src/lib/event-taxonomy.ts ./src/lib/event-taxonomy.ts
COPY src/lib/jam-countdown.ts ./src/lib/jam-countdown.ts
COPY src/lib/jam-links.ts ./src/lib/jam-links.ts
COPY src/lib/format-rate.ts ./src/lib/format-rate.ts
COPY src/lib/collab-vocabulary.ts ./src/lib/collab-vocabulary.ts
COPY src/lib/profile-links.ts ./src/lib/profile-links.ts
COPY src/lib/team-links.ts ./src/lib/team-links.ts

# The copied root files under /app/src import bare specifiers (posthog-node),
# which resolve up from /app — not from the service dir.
RUN ln -s /app/services/discord-bot/node_modules /app/node_modules

WORKDIR /app/services/discord-bot
CMD ["bun", "run", "start"]
