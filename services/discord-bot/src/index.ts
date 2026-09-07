import { Client, Events, GatewayIntentBits } from "discord.js";

import { createServiceTelemetry } from "../../../src/lib/service-telemetry.ts";
import { createPublicApi } from "./api.ts";
import { buildManifest } from "./commands/manifest.ts";
import { config } from "./config.ts";
import { createCooldown } from "./cooldown.ts";
import { createInteractionHandler } from "./discord/adapter.ts";
import { syncGuildCommands } from "./discord/register.ts";
import { createMemo } from "./memo.ts";

/**
 * The Discord bot (plan 28): slash commands answered from the site's public
 * API tier. One gateway connection with the `Guilds` intent — interactions
 * arrive regardless of intents, and nothing here reads messages — and every
 * answer is a GET to `$APP_URL/api/public/rpc` through the edge. No
 * database, no Redis, no queue; plan 20 adds those to this process.
 */

const telemetry = createServiceTelemetry("discord-bot");
const log = (line: string) => console.log(line);

const api = createPublicApi(config.APP_URL, { timeoutMs: config.BOT_API_TIMEOUT_MS, log });
const memo = createMemo(api, { hostName: config.JAM_HOST_NAME, log });
const cooldown = createCooldown({
  limit: config.COOLDOWN_LIMIT,
  windowMs: config.COOLDOWN_WINDOW_MS,
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(
  Events.InteractionCreate,
  createInteractionHandler({
    api,
    memo,
    cooldown,
    telemetry,
    appUrl: config.APP_URL,
    hostName: config.JAM_HOST_NAME,
    log,
  }),
);

client.once(Events.ClientReady, async (ready) => {
  log(`[boot] gateway ready as ${ready.user.tag}`);
  try {
    await syncGuildCommands(ready.rest, {
      applicationId: config.DISCORD_APPLICATION_ID,
      guildId: config.DISCORD_GUILD_ID,
      commands: buildManifest(),
      log,
    });
  } catch (error) {
    // Registration failing must not crash-loop the process: each loop would
    // re-attempt the PUT. Commands already registered keep working.
    console.error("[register] failed", error);
    telemetry.captureException(error, { scope: "register" });
  }
});

client.on(Events.Error, (error) => {
  console.error("[gateway] error", error);
  telemetry.captureException(error, { scope: "gateway" });
});
client.on(Events.ShardDisconnect, (event) => log(`[gateway] disconnected (${event.code})`));
client.on(Events.ShardResume, (_id, replayed) =>
  log(`[gateway] resumed, ${replayed} events replayed`),
);

// The memo warms while the gateway connects; autocomplete answers empty
// until the first refresh lands rather than holding the login.
const warm = memo.start().then(() => log(`[memo] warm ${JSON.stringify(memo.sizes())}`));
await client.login(config.DISCORD_BOT_TOKEN);
await warm;

log(`[boot] discord-bot started — api ${config.APP_URL}, guild ${config.DISCORD_GUILD_ID}`);

async function shutdown(signal: string) {
  log(`[boot] received ${signal}, draining...`);
  memo.stop();
  await client.destroy();
  // Before exit, not after: an interaction that failed in the last seconds
  // is exactly the one worth keeping.
  await telemetry.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
