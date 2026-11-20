import { Client, Events, GatewayIntentBits } from "discord.js";
import IORedis from "ioredis";

import { describe } from "../../../packages/discord-kit/src/index.ts";
import { createHandler, forumSink } from "./adapter.ts";
import { loadConfig } from "./config.ts";
import { localBudget, redisBudget } from "./cooldown.ts";
import { ForumPoster, type ForumStore } from "./forum.ts";
import { Lexicon } from "./lexicon.ts";
import { MediaCache } from "./media.ts";
import { Notifier } from "./notify.ts";
import { registerCommands } from "./register.ts";
import { httpWorld } from "./world.ts";

/**
 * The MMO bot: one gateway connection with the Guilds intent only (no
 * privileged intents; the game reads no messages), answering interactions
 * and posting the market forum from the world service's API.
 */
process.on("unhandledRejection", (e) => console.error(`[unhandled] ${describe(e)}`));
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
  ctx: { world, lex, threatLine: config.threatLine ?? lex.numbers.ambushLine },
  budget: redis ? redisBudget(redis) : localBudget(),
  media: (key) => media.get(key),
  onLong: (user, character) => notifier.watch(user, character),
});

client.on(Events.InteractionCreate, (i) => {
  handle(i).catch((e: unknown) => console.error(`[interaction] ${describe(e)}`));
});
client.once(Events.ClientReady, async (c) => {
  console.log(`[ready] ${c.user.tag}`);
  await registerCommands(config).catch((e: unknown) => console.error(`[register] ${describe(e)}`));
  notifier.start();
  if (config.marketForum && !redis) {
    // Without a durable store every restart would open the posts again.
    console.warn("[forum] MMO_MARKET_FORUM is set but REDIS_URL is not; the forum is not posted");
  } else if (config.marketForum && redis) {
    const store: ForumStore = {
      get: (k) => redis.get(k),
      set: async (k, v) => void (await redis.set(k, v)),
    };
    new ForumPoster(
      world,
      lex,
      store,
      forumSink(client, config.marketForum, (k) => media.get(k)),
    ).start();
  }
});
await client.login(config.token);
