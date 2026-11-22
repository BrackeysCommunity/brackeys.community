import { Client, Events, GatewayIntentBits } from "discord.js";
import IORedis from "ioredis";

import { describe } from "../../../packages/discord-kit/src/index.ts";
import { channelSink, createHandler, forumSink, threadSink } from "./adapter.ts";
import * as api from "./api.ts";
import { ChroniclePoster } from "./chronicle.ts";
import { loadConfig } from "./config.ts";
import { localBudget, redisBudget } from "./cooldown.ts";
import { EventsPoster } from "./events.ts";
import { BoardPoster, ForumPoster, type ForumStore, memoryStore } from "./forum.ts";
import { HuntPoster } from "./hunts.ts";
import { Lexicon } from "./lexicon.ts";
import { MediaCache } from "./media.ts";
import { Notifier } from "./notify.ts";
import { PartyPoster } from "./party.ts";
import { ThreadBudget } from "./publish.ts";
import { registerCommands } from "./register.ts";
import { EVENTS_CHANNEL } from "./screens/story.ts";
import { httpWorld } from "./world.ts";

/**
 * The MMO bot: one gateway connection with the Guilds intent only (no
 * privileged intents; the game reads no messages), answering interactions,
 * keeping party threads, and posting the market and notice-board forums,
 * the events channel (with the hunts, which stay in the game channel when
 * there is no events channel) and the chronicle channel from the world
 * service's API.
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
  alarmRole: config.eventsAlarmRole,
});

client.on(Events.InteractionCreate, (i) => {
  handle(i).catch((e: unknown) => console.error(`[interaction] ${describe(e)}`));
});
client.once(Events.ClientReady, async (c) => {
  console.log(`[ready] ${c.user.tag}`);
  await registerCommands(config).catch((e: unknown) => console.error(`[register] ${describe(e)}`));
  notifier.start();
  parties.start();
  const { marketForum, goalsForum, gameChannel, eventsChannel, chronicleChannel } = config;
  if (!marketForum && !goalsForum && !gameChannel && !eventsChannel && !chronicleChannel) return;
  if (!redis) {
    // Without a durable store every restart would open the posts again.
    console.warn("[forum] a forum or channel is set but REDIS_URL is not; nothing is posted");
    return;
  }
  const channel = (id: string) => channelSink(client, id, (k) => media.get(k));
  const huntChannel = eventsChannel ?? gameChannel;
  if (huntChannel)
    new HuntPoster(
      world,
      lex,
      store,
      channel(huntChannel),
      undefined,
      undefined,
      eventsChannel ? EVENTS_CHANNEL : undefined,
    ).start();
  if (eventsChannel)
    new EventsPoster(
      {
        storyEvents: (after) => world.storyEvents(after),
        arcs: () => world.arcs(""),
        hunts: () => world.hunts(),
      },
      lex,
      store,
      channel(eventsChannel),
      config.eventsAlarmRole,
    ).start();
  if (chronicleChannel)
    new ChroniclePoster(
      {
        async chronicle(server) {
          const r = await world.chronicle("", undefined, server);
          if (r.ok) return r.reply;
          // Not found: no world day has closed yet.
          if (r.refusal.code === api.CodeNotFound) return null;
          throw new Error(`chronicle refused: ${r.refusal.code} ${r.refusal.message ?? ""}`);
        },
      },
      lex,
      store,
      channel(chronicleChannel),
      config.guildId,
    ).start();
  const sink = (id: string) => forumSink(client, id, (k) => media.get(k));
  if (marketForum) new ForumPoster(world, lex, store, sink(marketForum)).start();
  if (goalsForum) new BoardPoster(world, lex, store, sink(goalsForum)).start();
});
await client.login(config.token);
