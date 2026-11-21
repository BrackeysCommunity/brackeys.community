import { Client, Events, GatewayIntentBits } from "discord.js";
import IORedis from "ioredis";

import { describe } from "../../../packages/discord-kit/src/index.ts";
import { channelSink, createHandler, forumSink, threadSink } from "./adapter.ts";
import { loadConfig } from "./config.ts";
import { localBudget, redisBudget } from "./cooldown.ts";
import { BoardPoster, ForumPoster, type ForumStore, memoryStore } from "./forum.ts";
import { HuntPoster } from "./hunts.ts";
import { Lexicon } from "./lexicon.ts";
import { MediaCache } from "./media.ts";
import { Notifier } from "./notify.ts";
import { PartyPoster } from "./party.ts";
import { ThreadBudget } from "./publish.ts";
import { registerCommands } from "./register.ts";
import { httpWorld } from "./world.ts";

/**
 * The MMO bot: one gateway connection with the Guilds intent only (no
 * privileged intents; the game reads no messages), answering interactions,
 * keeping party threads, and posting the market and notice-board forums and
 * the game channel's hunts from the world service's API.
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
const store: ForumStore = redis
  ? {
      get: (k) => redis.get(k),
      set: async (k, v) => void (await redis.set(k, v)),
      del: async (k) => void (await redis.del(k)),
    }
  : memoryStore();
// Without Redis a restart forgets which threads are open; the next press opens one again.
if (!redis) console.warn("[party] REDIS_URL is not set; party threads are kept in memory");
const parties = new PartyPoster(
  world,
  lex,
  store,
  threadSink(client, (k) => media.get(k)),
  new ThreadBudget(),
);
const handle = createHandler({
  ctx: { world, lex, threatLine: config.threatLine ?? lex.numbers.ambushLine },
  budget: redis ? redisBudget(redis) : localBudget(),
  media: (key) => media.get(key),
  onLong: (user, character) => notifier.watch(user, character),
  onParty: (note) => parties.note(note),
});

client.on(Events.InteractionCreate, (i) => {
  handle(i).catch((e: unknown) => console.error(`[interaction] ${describe(e)}`));
});
client.once(Events.ClientReady, async (c) => {
  console.log(`[ready] ${c.user.tag}`);
  await registerCommands(config).catch((e: unknown) => console.error(`[register] ${describe(e)}`));
  notifier.start();
  parties.start();
  if (!config.marketForum && !config.goalsForum && !config.gameChannel) return;
  if (!redis) {
    // Without a durable store every restart would open the posts again.
    console.warn("[forum] a forum or game channel is set but REDIS_URL is not; nothing is posted");
    return;
  }
  if (config.gameChannel)
    new HuntPoster(
      world,
      lex,
      store,
      channelSink(client, config.gameChannel, (k) => media.get(k)),
    ).start();
  const sink = (channel: string) => forumSink(client, channel, (k) => media.get(k));
  if (config.marketForum) new ForumPoster(world, lex, store, sink(config.marketForum)).start();
  if (config.goalsForum) new BoardPoster(world, lex, store, sink(config.goalsForum)).start();
});
await client.login(config.token);
