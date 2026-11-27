import { Client, Events, GatewayIntentBits } from "discord.js";
import IORedis from "ioredis";

import { describe } from "../../../packages/discord-kit/src/index.ts";
import {
  channelSink,
  createHandler,
  forumSink,
  guildChannel,
  onGuilds,
  threadSink,
} from "./adapter.ts";
import { CHRONICLE_POLL_MS, ChroniclePoster, chronicleSource } from "./chronicle.ts";
import { loadConfig } from "./config.ts";
import { localBudget, redisBudget } from "./cooldown.ts";
import { EVENTS_POLL_MS, EventsPoster } from "./events.ts";
import { forgetUser } from "./forget.ts";
import { BoardPoster, FORUM_POLL_MS, ForumPoster, type ForumStore, memoryStore } from "./forum.ts";
import {
  type ChannelKind,
  Houses,
  memoryHeldNames,
  redisHeldNames,
  redisSwitchWriter,
} from "./house.ts";
import { GuildPosters, HUNT_POLL_MS, HuntPoster, type Poller, posterPrefix } from "./hunts.ts";
import { Lexicon } from "./lexicon.ts";
import { LogPoster } from "./logs.ts";
import { MediaCache } from "./media.ts";
import { narrationParts, narratorFor } from "./narration/index.ts";
import { redisNarrationStore } from "./narration/redis.ts";
import { redisSwitch } from "./narration/switch.ts";
import { Notifier } from "./notify.ts";
import { PartyPoster } from "./party.ts";
import { PROMOTIONS_POLL_MS, PromotionsPoster } from "./promotions.ts";
import { ThreadBudget } from "./publish.ts";
import { LexiconRefresher } from "./refresh.ts";
import { registerCommands } from "./register.ts";
import { EVENTS_CHANNEL } from "./screens/story.ts";
import { httpWorld } from "./world.ts";

/**
 * The MMO bot: one gateway connection with the Guilds intent only (no
 * privileged intents; the game reads no messages), answering interactions,
 * keeping party threads, and posting the market and notice-board forums,
 * the events or game channel's hunts, the events channel and the chronicle
 * channel, its promotions among them, from the world service's API. Each
 * server's staff and admins have their consoles, and its public log is
 * posted to its log channel. The posters follow the servers the bot is
 * in, so a server that installs it is posted to from its first poll.
 */
process.on("unhandledRejection", (e) => console.error(`[unhandled] ${describe(e)}`));
const config = loadConfig();
const world = httpWorld(config.worldUrl, config.worldToken);
const lex = new Lexicon(await world.lexicon());
const lexicon = new LexiconRefresher(lex, () => world.lexicon());
const redis = config.redisUrl
  ? new IORedis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
  : null;
redis?.on("error", (e) => console.warn(`[redis] ${e.message}`));
const sw = redis ? redisSwitch(redis, true) : undefined;
const narrator = narratorFor(config, redis, console.log, undefined, sw);
console.log(
  narrator
    ? "[narration] the model is on where the switch allows it"
    : "[narration] off: it needs MMO_NARRATION=on, ANTHROPIC_API_KEY and REDIS_URL",
);
const parts = narrationParts(narrator, redis ? redisNarrationStore(redis) : null, lex, { sw });
const { narration, day } = parts;
const houses = new Houses(world, {
  writeSwitch: redis ? redisSwitchWriter(redis) : undefined,
  held: redis ? redisHeldNames(redis) : memoryHeldNames(),
});
// Seeded once so stage endings and screens are costed under the right day before a chronicle post.
try {
  const r = await world.chronicle("", undefined, config.guildId);
  if (r.ok) day.saw(r.reply.day + 1);
} catch (e) {
  console.warn(`[narration] the world day is not known yet: ${describe(e)}`);
}
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
  ctx: {
    world,
    lex,
    threatLine: config.threatLine ?? lex.numbers.ambushLine,
    ...parts,
    house: houses,
    // The bot's own keys for a forgotten player (GDD 14.9); the user's id is never logged.
    forget: redis
      ? async (user: string) => {
          const n = await forgetUser(redis, user);
          console.log(`[forget] ${n} bot keys removed`);
        }
      : undefined,
  },
  budget: redis ? redisBudget(redis) : localBudget(),
  media: (key) => media.get(key),
  onLong: (user, character) => notifier.watch(user, character),
  onParty: (note) => parties.note(note),
  alarmRole: config.eventsAlarmRole,
  staffRoles: (guild) => houses.staffRolesOf(guild),
  alarmRoles: (guild) => houses.alarmRolesOf(guild),
});

client.on(Events.InteractionCreate, (i) => {
  handle(i).catch((e: unknown) => console.error(`[interaction] ${describe(e)}`));
});
client.once(Events.ClientReady, async (c) => {
  console.log(`[ready] ${c.user.tag}`);
  await registerCommands(config).catch((e: unknown) => console.error(`[register] ${describe(e)}`));
  notifier.start();
  parties.start();
  lexicon.start(config.lexiconRefreshMs);
  if (!redis) {
    // Without a durable store every restart would open the posts again.
    console.warn("[forum] REDIS_URL is not set; no channel, forum or log is posted");
    return;
  }
  const { guildId: primary } = config;
  /** The guilds the bot is in, which every poster follows. */
  const followed: string[] = [];
  const posters: GuildPosters<Poller>[] = [];
  const follow = <P extends Poller>(p: GuildPosters<P>, ms: number) => {
    for (const g of followed) p.add(g);
    posters.push(p);
    p.start(ms);
  };
  const channel = (id: string) => channelSink(client, id, (k) => media.get(k));
  const sink = (id: string) => forumSink(client, id, (k) => media.get(k));
  /** The bot's own channel for a kind in a guild: the primary guild's env id as it is, else looked up in that guild. */
  const own = (guild: string, ref: string | undefined) =>
    ref && guild === primary && /^\d+$/.test(ref)
      ? Promise.resolve(ref)
      : guildChannel(client, guild, ref);
  /** A kind's channel in a guild: the one its settings map, else the bot's own. */
  const mapped = (kind: ChannelKind, ref: string | undefined) => async (guild: string) =>
    (await houses.channelOf(guild, kind)) ?? (await own(guild, ref));
  const prefix = (base: string, ref: string | undefined) => (guild: string, id: string) =>
    posterPrefix(base, guild, id, ref ? { guild: primary, channel: ref } : undefined);
  /** The world's reads as one guild's server reads them. */
  const worldFor = (guild: string) => ({
    board: () => world.board(guild),
    forum: () => world.forum(guild),
    hunts: () => world.hunts(),
    arcs: (id = "") => world.arcs(id, guild),
    storyEvents: (after: number) => world.storyEvents(after, guild),
    storyPromotions: (after: number) => world.storyPromotions(after, guild),
    chronicle: (id?: string, day?: number) => world.chronicle(id, day, guild),
    chronicleFact: (id: string | undefined, fact: number) => world.chronicleFact(id, fact, guild),
  });
  const audience = (guild: string) => ({
    server: guild,
    houses,
    board: worldFor(guild).board,
    now: Date.now,
  });

  new LogPoster(
    world,
    houses,
    store,
    channel,
    () => followed,
    (guild) => own(guild, config.logChannel),
  ).start();

  const { marketForum, goalsForum, gameChannel, eventsChannel, chronicleChannel } = config;
  const huntRef = eventsChannel ?? gameChannel;
  const huntPrefix = prefix("mmo-bot:hunt:", huntRef);
  follow(
    new GuildPosters(
      [],
      mapped("events", huntRef),
      (guild, id) =>
        new HuntPoster(
          worldFor(guild),
          lex,
          store,
          channel(id),
          huntPrefix(guild, id),
          undefined,
          id === gameChannel ? undefined : EVENTS_CHANNEL,
          audience(guild),
        ),
      console.log,
      "hunts",
    ),
    HUNT_POLL_MS,
  );

  const eventsPrefix = prefix("mmo-bot:events:", eventsChannel);
  follow(
    new GuildPosters(
      [],
      mapped("events", eventsChannel),
      (guild, id) =>
        new EventsPoster(
          worldFor(guild),
          lex,
          store,
          channel(id),
          config.eventsAlarmRole,
          eventsPrefix(guild, id),
          undefined,
          (ev, mode, template) => {
            const card = template();
            return card && narration.event(ev, guild, mode, () => card);
          },
          audience(guild),
        ),
      console.log,
      "events",
    ),
    EVENTS_POLL_MS,
  );

  const chroniclePrefix = prefix("mmo-bot:chronicle:", chronicleChannel);
  follow(
    new GuildPosters(
      [],
      mapped("chronicle", chronicleChannel),
      (guild, id) =>
        new ChroniclePoster(
          chronicleSource((server) => worldFor(server).chronicle("")),
          lex,
          store,
          channel(id),
          guild,
          chroniclePrefix(guild, id),
          undefined,
          (ch, template) => narration.chronicle(ch, guild, "post", template),
          (d) => day.saw(d),
        ),
      console.log,
      "chronicle",
    ),
    CHRONICLE_POLL_MS,
  );

  const promotionsPrefix = prefix("mmo-bot:promotions:", chronicleChannel);
  follow(
    new GuildPosters(
      [],
      mapped("chronicle", chronicleChannel),
      (guild, id) =>
        new PromotionsPoster(
          worldFor(guild),
          lex,
          store,
          channel(id),
          () => lexicon.refresh(),
          promotionsPrefix(guild, id),
        ),
      console.log,
      "promotions",
    ),
    PROMOTIONS_POLL_MS,
  );

  const marketPrefix = prefix("mmo-bot:forum:", marketForum);
  follow(
    new GuildPosters(
      [],
      mapped("market", marketForum),
      (guild, id) =>
        new ForumPoster(worldFor(guild), lex, store, sink(id), marketPrefix(guild, id)),
      console.log,
      "forum",
    ),
    FORUM_POLL_MS,
  );

  const boardPrefix = prefix("mmo-bot:board:", goalsForum);
  follow(
    new GuildPosters(
      [],
      mapped("board", goalsForum),
      (guild, id) => new BoardPoster(worldFor(guild), lex, store, sink(id), boardPrefix(guild, id)),
      console.log,
      "board",
    ),
    FORUM_POLL_MS,
  );

  // Guild-scoped commands exist only in MMO_GUILD_IDS, so a test bot posts nowhere else.
  const serves = (guild: string) => config.commands === "global" || config.guildIds.includes(guild);
  onGuilds(
    client,
    (guild) => {
      if (!serves(guild) || followed.includes(guild)) return;
      followed.push(guild);
      for (const p of posters) p.add(guild);
      console.log(`[guilds] following ${guild} (${followed.length} in all)`);
    },
    (guild) => {
      const i = followed.indexOf(guild);
      if (i >= 0) followed.splice(i, 1);
      for (const p of posters) p.remove(guild);
      houses.forget(guild);
      console.log(`[guilds] left ${guild} (${followed.length} in all)`);
    },
  );
});
await client.login(config.token);
