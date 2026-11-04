import {
  createDiscordGuard,
  DiscordBackoffError,
  type GuardRedis,
  isRouteLimit,
} from "../../../../src/lib/discord-guard.ts";

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

/** Route 429s waited out per page before the read gives up as throttled. */
const ROUTE_RETRIES = 3;

/** How long the bucket says to wait, in seconds; the float header first. */
function waitSeconds(response: Response): number {
  for (const header of ["x-ratelimit-reset-after", "retry-after"]) {
    const value = Number(response.headers.get(header));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 1;
}

/**
 * Pages of a channel's history over REST, newest first. Goes through the
 * backoff guard shared with the web app, because a global 429 on our egress
 * IP puts sign-in at risk too.
 *
 * The messages route allows a handful of reads a second per channel, and
 * paging a busy channel spends that in one go. Pages for a channel are read
 * one at a time across every summary in flight, each waiting out an
 * exhausted bucket before the next is asked for, and a route 429 that still
 * slips through (another process, a skewed clock) is waited out and retried.
 */
export function createHistoryReader(botToken: string, redis: GuardRedis): ReadHistory {
  const guardedFetch = createDiscordGuard(async () => redis);
  const queues = new Map<string, Promise<unknown>>();

  function inTurn<T>(channelId: string, work: () => Promise<T>): Promise<T> {
    const run = (queues.get(channelId) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => undefined);
    queues.set(channelId, tail);
    void tail.then(() => {
      if (queues.get(channelId) === tail) queues.delete(channelId);
    });
    return run;
  }

  async function readPage(channelId: string, before: string, limit: number) {
    for (let attempt = 0; ; attempt++) {
      const response = await guardedFetch(
        `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}&before=${before}`,
        { headers: { Authorization: `Bot ${botToken}` } },
      );
      if (response.status === 429) {
        const wait = waitSeconds(response);
        if (isRouteLimit(response) && attempt < ROUTE_RETRIES) {
          await sleep(wait * 1000);
          continue;
        }
        throw new DiscordBackoffError(Date.now() + wait * 1000);
      }
      if (response.status === 403 || response.status === 404) {
        throw new ChannelUnreadableError(channelId, response.status);
      }
      if (!response.ok) throw new Error(`Channel history read failed: ${response.status}`);
      if (response.headers.get("x-ratelimit-remaining") === "0") {
        await sleep(waitSeconds(response) * 1000);
      }
      return (await response.json()) as DiscordApiMessage[];
    }
  }

  return (channelId, before, limit = 100) =>
    inTurn(channelId, () => readPage(channelId, before, limit));
}
