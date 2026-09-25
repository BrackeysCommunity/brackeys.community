import { siteUrl } from "@/env";
import {
  absoluteImageUrl,
  DiscordFeedError,
  type DiscordMessagePayload,
  truncate,
} from "@/lib/collab-discord-feed";
import { discordWriteFetch } from "@/lib/discord";
import { ACCENT_RECRUITING } from "@/lib/discord-embed";
import { discordMessageLink } from "@/lib/discord-links";
import { deleteDiscordMessage } from "@/lib/discord-message-delete";
import { censorText } from "@/lib/profanity";

/**
 * Mirroring a devlog into the guild's `#devlogs` channel — the collab
 * feed's one-way bridge (`collab-discord-feed.ts`), pointed at a different
 * channel. The author ticks "Share to #devlogs" and an embed that links
 * home lands in the channel; edits rewrite it, and a deleted or hidden
 * devlog takes it down.
 *
 * Unset `DISCORD_DEVLOGS_CHANNEL_ID` is the normal state for any deploy
 * whose guild has no such channel: the checkbox simply isn't offered. A
 * 403 hides it the same way for a while, with its own window — a refusal
 * in one channel says nothing about the other.
 */

export interface DevlogFeedConfig {
  channelId: string;
  guildId: string;
  botToken: string;
}

export function devlogFeedConfig(): DevlogFeedConfig | null {
  const channelId = process.env.DISCORD_DEVLOGS_CHANNEL_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!channelId || !guildId || !botToken) return null;
  return { channelId, guildId, botToken };
}

const REFUSAL_WINDOW_MS = 15 * 60_000;
let refusedUntil = 0;

export function devlogFeedEnabled(now: number = Date.now()): boolean {
  return devlogFeedConfig() != null && refusedUntil <= now;
}

export function clearDevlogFeedRefusal(): void {
  refusedUntil = 0;
}

export function devlogFeedMessageUrl(
  config: DevlogFeedConfig,
  channelId: string,
  messageId: string,
): string {
  return discordMessageLink(config.guildId, channelId, messageId);
}

export interface DevlogFeedPost {
  id: number;
  title: string;
  slugPath: string;
  excerpt: string | null;
  coverUrl: string | null;
  publishedAt: Date | null;
  tags: string[];
  series: { title: string; index: number | null } | null;
  team: { name: string; path: string; avatarUrl: string | null } | null;
  author: { name: string; path: string | null; avatarUrl: string | null } | null;
}

/** The embed, as a pure function of the devlog. */
export function buildDevlogFeedMessage(post: DevlogFeedPost): DiscordMessagePayload {
  const url = siteUrl(post.slugPath);
  const fields = [];
  if (post.series) {
    fields.push({
      name: "Series",
      value: truncate(
        post.series.index != null
          ? `${post.series.title} · Entry ${post.series.index}`
          : post.series.title,
        200,
      ),
      inline: true,
    });
  }
  if (post.tags.length > 0) {
    fields.push({
      name: "Tags",
      value: truncate(post.tags.map((t) => `#${t}`).join(" "), 200),
      inline: true,
    });
  }
  const byline = post.team
    ? { name: post.team.name, url: siteUrl(post.team.path), iconUrl: post.team.avatarUrl }
    : post.author
      ? {
          name: post.author.name,
          url: post.author.path ? siteUrl(post.author.path) : null,
          iconUrl: post.author.avatarUrl,
        }
      : null;
  const cover = absoluteImageUrl(post.coverUrl);
  const icon = byline ? absoluteImageUrl(byline.iconUrl) : null;

  return {
    embeds: [
      {
        title: truncate(censorText(post.title), 240),
        url,
        description: truncate(censorText(post.excerpt ?? ""), 480),
        color: ACCENT_RECRUITING,
        fields,
        ...(byline
          ? {
              author: {
                name: truncate(byline.name, 200),
                ...(byline.url ? { url: byline.url } : {}),
                ...(icon ? { icon_url: icon } : {}),
              },
            }
          : {}),
        ...(cover ? { image: { url: cover } } : {}),
        footer: { text: "Brackeys forum · devlog" },
        ...(post.publishedAt ? { timestamp: new Date(post.publishedAt).toISOString() } : {}),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: "Read the devlog", url },
          { type: 2, style: 5, label: "More devlogs", url: siteUrl("/forum?kind=devlog") },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function failure(response: Response, action: string): Promise<DiscordFeedError> {
  if (response.status === 403) refusedUntil = Date.now() + REFUSAL_WINDOW_MS;
  const body = await response.text().catch(() => "");
  return new DiscordFeedError(
    `Discord refused to ${action} the devlog message: ${response.status} ${body.slice(0, 200)}`,
    response.status,
  );
}

export async function postDevlogFeedMessage(
  config: DevlogFeedConfig,
  payload: DiscordMessagePayload,
): Promise<string> {
  const response = await discordWriteFetch(
    `https://discord.com/api/v10/channels/${config.channelId}/messages`,
    { method: "POST", headers: { Authorization: `Bot ${config.botToken}` }, body: payload },
  );
  if (!response.ok) throw await failure(response, "post");
  clearDevlogFeedRefusal();
  const message = (await response.json()) as { id?: string };
  if (!message.id) throw new DiscordFeedError("Discord accepted the message but returned no id");
  return message.id;
}

/** `"gone"`: someone removed the message in Discord; it isn't ours to restore. */
export async function editDevlogFeedMessage(
  config: DevlogFeedConfig,
  channelId: string,
  messageId: string,
  payload: DiscordMessagePayload,
): Promise<"edited" | "gone"> {
  const response = await discordWriteFetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    { method: "PATCH", headers: { Authorization: `Bot ${config.botToken}` }, body: payload },
  );
  if (response.ok) return "edited";
  if (response.status === 404) return "gone";
  throw await failure(response, "edit");
}

export async function deleteDevlogFeedMessage(
  config: DevlogFeedConfig,
  channelId: string,
  messageId: string,
): Promise<void> {
  await deleteDiscordMessage({
    botToken: config.botToken,
    channelId,
    messageId,
    fetchImpl: (url, init) => discordWriteFetch(url, init),
  });
}
