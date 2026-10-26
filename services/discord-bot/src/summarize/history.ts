import { createDiscordGuard, type GuardRedis } from "../../../../src/lib/discord-guard.ts";

export interface DiscordApiMessage {
  id: string;
  type: number;
  content: string;
  timestamp: string;
  author: { id: string; username: string; global_name?: string | null; bot?: boolean };
  mentions?: { id: string; username: string; global_name?: string | null }[];
  attachments?: { content_type?: string }[];
  sticker_items?: unknown[];
  referenced_message?: {
    author: { username: string; global_name?: string | null };
  } | null;
}

export type ReadHistory = (
  channelId: string,
  before: string,
  limit?: number,
) => Promise<DiscordApiMessage[]>;

export class ChannelUnreadableError extends Error {
  constructor(channelId: string, status: number) {
    super(`Channel ${channelId} is not readable by the bot (${status})`);
    this.name = "ChannelUnreadableError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pages of a channel's history over REST, newest first. Goes through the
 * backoff guard shared with the web app, because a 429 on our egress IP
 * puts sign-in at risk too. Paging a busy channel can spend the route's
 * whole bucket, so each page waits out an exhausted bucket before the next
 * one is asked for rather than provoking that 429.
 */
export function createHistoryReader(botToken: string, redis: GuardRedis): ReadHistory {
  const guardedFetch = createDiscordGuard(async () => redis);
  return async (channelId, before, limit = 100) => {
    const response = await guardedFetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}&before=${before}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    );
    if (response.status === 403 || response.status === 404) {
      throw new ChannelUnreadableError(channelId, response.status);
    }
    if (!response.ok) throw new Error(`Channel history read failed: ${response.status}`);
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      const resetAfter = Number(response.headers.get("x-ratelimit-reset-after"));
      if (Number.isFinite(resetAfter) && resetAfter > 0) await sleep(resetAfter * 1000);
    }
    return (await response.json()) as DiscordApiMessage[];
  };
}
