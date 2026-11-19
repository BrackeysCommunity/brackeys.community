import { Client, Events, GatewayIntentBits, REST } from "discord.js";
import IORedis from "ioredis";

import { syncGuildCommands } from "../../../packages/discord-kit/src/index.ts";
import { createHandler, describe } from "./adapter.ts";
import { loadConfig } from "./config.ts";
import { localBudget, redisBudget } from "./cooldown.ts";
import { Lexicon } from "./lexicon.ts";
import { MANIFEST } from "./manifest.ts";
import { MediaCache } from "./media.ts";
import { Notifier } from "./notify.ts";
import { httpWorld } from "./world.ts";

/**
 * The MMO bot: one gateway connection with the Guilds intent only (no
 * privileged intents; the game reads no messages), answering interactions
 * from the world service's API.
 */
const config = loadConfig();
const world = httpWorld(config.worldUrl, config.worldToken);
const lex = new Lexicon(await world.lexicon());
const redis = config.redisUrl
  ? new IORedis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
  : null;
redis?.on("error", (e) => console.warn(`[redis] ${e.message}`));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const notifier = new Notifier(world, async (user, text) => {
  const u = await client.users.fetch(user);
  await u.send(text);
});
const media = new MediaCache((key) => world.media(key));
const handle = createHandler({
  ctx: { world, lex, threatLine: config.threatLine },
  budget: redis ? redisBudget(redis) : localBudget(),
  media: (key) => media.get(key),
  onLong: (user, character) => notifier.watch(user, character),
});

client.on(Events.InteractionCreate, (i) => {
  handle(i).catch((e: unknown) => console.error(`[interaction] ${describe(e)}`));
});
client.once(Events.ClientReady, async (c) => {
  console.log(`[ready] ${c.user.tag}`);
  const rest = new REST().setToken(config.token);
  await syncGuildCommands(rest, {
    applicationId: config.applicationId,
    guildId: config.guildId,
    commands: MANIFEST,
    log: console.log,
  }).catch((e: unknown) => console.error(`[register] ${describe(e)}`));
  notifier.start();
});
await client.login(config.token);
