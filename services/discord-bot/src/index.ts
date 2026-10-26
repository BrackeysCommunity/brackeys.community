import {
  Client,
  Events,
  GatewayIntentBits,
  type GuildMember,
  Options,
  type PartialGuildMember,
  type PartialUser,
  Partials,
  type User,
} from "discord.js";

import { EVENTS } from "../../../src/lib/event-taxonomy.ts";
import { createServiceTelemetry } from "../../../src/lib/service-telemetry.ts";
import { createPublicApi } from "./api.ts";
import { COMMAND } from "./commands/dispatch.ts";
import { buildManifest, manifestOptions } from "./commands/manifest.ts";
import type { Summarize } from "./commands/summarize.ts";
import { config } from "./config.ts";
import { createCooldown } from "./cooldown.ts";
import { createInteractionHandler } from "./discord/adapter.ts";
import { syncGuildCommands } from "./discord/register.ts";
import { createMemberRelay, identityChanged, type MemberIdentity } from "./member-relay.ts";
import { createMemo } from "./memo.ts";
import { redis } from "./redis.ts";
import { siteName } from "./reply.ts";
import { createHistoryReader } from "./summarize/history.ts";
import { createSummaryModel } from "./summarize/model.ts";
import { createSummarizer } from "./summarize/summarizer.ts";

/**
 * The Discord bot (plan 28): slash commands answered from the site's public
 * API tier. Lookups are a GET to `$APP_URL/api/public/rpc` through the edge.
 *
 * With `MEMBER_RELAY` on it also holds `GuildMembers`, and tells the site
 * when a member's avatar or name changes so their profile doesn't wait for
 * the daily resync.
 *
 * With `REDIS_URL` and `ANTHROPIC_API_KEY` it also offers `/summarize`
 * (plan 49): on a member's request it reads the channel the command ran in
 * over REST and summarizes it, caching summaries (never messages) in
 * Dragonfly for 30 days. It holds `GuildMessages` only to hear deletions,
 * which drop the cached summaries that contained them; it does not request
 * message content over the gateway and caches no messages.
 */

const telemetry = createServiceTelemetry("discord-bot");
const log = (line: string) => console.log(line);

const api = createPublicApi(config.APP_URL, { timeoutMs: config.BOT_API_TIMEOUT_MS, log });
const memo = createMemo(api, { hostName: config.JAM_HOST_NAME, log });
const cooldown = createCooldown({
  limit: config.COOLDOWN_LIMIT,
  windowMs: config.COOLDOWN_WINDOW_MS,
});

const summaryCooldown = createCooldown({
  limit: config.SUMMARY_COOLDOWN_LIMIT,
  windowMs: config.SUMMARY_COOLDOWN_WINDOW_MS,
});

const summarizer =
  redis && config.ANTHROPIC_API_KEY
    ? createSummarizer({
        redis,
        readHistory: createHistoryReader(config.DISCORD_BOT_TOKEN, redis),
        model: createSummaryModel(config.ANTHROPIC_API_KEY),
      })
    : null;

const summarize: Summarize | undefined = summarizer
  ? async (channelId, window) => {
      const summary = await summarizer.summarize(channelId, window);
      if (!summary.finalCached && summary.text) {
        telemetry.capture(EVENTS.botSummaryGenerated, {
          window,
          message_count: summary.messageCount,
          buckets_cached: summary.buckets.cached,
          buckets_summarized: summary.buckets.summarized,
          buckets_raw: summary.buckets.raw,
          input_tokens: summary.inputTokens,
          output_tokens: summary.outputTokens,
          cost_usd: summary.costUsd,
          truncated: summary.truncated,
        });
      }
      return summary;
    }
  : undefined;

const memberRelay = config.MEMBER_RELAY
  ? createMemberRelay({ appUrl: config.APP_URL, secret: config.DISCORD_BOT_TOKEN, log })
  : null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    ...(memberRelay ? [GatewayIntentBits.GuildMembers] : []),
    ...(summarizer ? [GatewayIntentBits.GuildMessages] : []),
  ],
  // Members aren't cached ahead of time, so an update for one we haven't
  // seen arrives with a partial old copy — without these it isn't emitted.
  // Messages are never cached at all, so every deletion arrives partial.
  partials: [
    ...(memberRelay ? [Partials.GuildMember, Partials.User] : []),
    ...(summarizer ? [Partials.Message] : []),
  ],
  makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 0 }),
});

function userIdentity(user: User | PartialUser): MemberIdentity | null {
  if (user.partial) return null;
  return { guildAvatar: null, nickname: null, avatar: user.avatar, username: user.username };
}

function memberIdentity(member: GuildMember | PartialGuildMember): MemberIdentity | null {
  if (member.partial) return null;
  return {
    guildAvatar: member.avatar,
    nickname: member.nickname,
    avatar: member.user.avatar,
    username: member.user.username,
  };
}

if (memberRelay) {
  client.on(Events.GuildMemberUpdate, (old, next) => {
    if (next.guild.id !== config.DISCORD_GUILD_ID) return;
    if (identityChanged(memberIdentity(old), memberIdentity(next)!)) memberRelay.relay(next.id);
  });
  client.on(Events.UserUpdate, (old, next) => {
    if (identityChanged(userIdentity(old), userIdentity(next)!)) memberRelay.relay(next.id);
  });
}

if (summarizer) {
  client.on(Events.MessageDelete, (message) => {
    if (message.guildId !== config.DISCORD_GUILD_ID) return;
    void summarizer.invalidate(message.channelId, [message.id]);
  });
  client.on(Events.MessageBulkDelete, (messages, channel) => {
    if (channel.guildId !== config.DISCORD_GUILD_ID) return;
    void summarizer.invalidate(channel.id, [...messages.keys()]);
  });
}

client.on(
  Events.InteractionCreate,
  createInteractionHandler({
    api,
    memo,
    cooldown,
    commandCooldowns: { [COMMAND.summarize]: summaryCooldown },
    telemetry,
    summarize,
    appUrl: config.APP_URL,
    hostName: config.JAM_HOST_NAME,
    shareGate: {
      roleIds: config.SHARE_ROLE_IDS,
      botChannelId: config.BOT_CHANNEL_ID ?? null,
      botChannelName: config.BOT_CHANNEL_NAME,
    },
    log,
  }),
);

client.once(Events.ClientReady, async (ready) => {
  log(`[boot] gateway ready as ${ready.user.tag}`);
  try {
    await syncGuildCommands(ready.rest, {
      applicationId: config.DISCORD_APPLICATION_ID,
      guildId: config.DISCORD_GUILD_ID,
      commands: buildManifest(siteName(config.APP_URL), manifestOptions(config)),
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
  memberRelay?.stop();
  await client.destroy();
  redis?.disconnect();
  // Before exit, not after: an interaction that failed in the last seconds
  // is exactly the one worth keeping.
  await telemetry.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
