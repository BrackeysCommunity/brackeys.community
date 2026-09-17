import { siteUrl } from "@/env";
import { discordWriteFetch } from "@/lib/discord";
import { discordMessageLink } from "@/lib/discord-links";
import { formatRate } from "@/lib/format-rate";
import { jamSlug } from "@/lib/jam-links";
import { teamSlug } from "@/lib/team-links";

/**
 * Mirroring a collab post into the guild's feed channel.
 *
 * The board moved off Discord and the channel it replaced went quiet, so
 * members who live in Discord stopped seeing that anyone was recruiting at
 * all. This is the one-way bridge back: the author presses a button on
 * their own post and the site drops an embed in the feed channel that links
 * home. Nothing flows the other way — a reply in Discord is not an
 * application, and the embed says so by only ever offering the link.
 *
 * Unconfigured (no channel id) is a first-class state, not an error: local
 * dev and any deploy whose guild has no such channel simply never show the
 * button.
 */

/** Discord's own caps, minus the ellipsis we add. */
const TITLE_MAX = 240;
const DESCRIPTION_MAX = 480;
const FIELD_MAX = 1000;

/** Brackeys purple for a live post, muted grey once it stops recruiting. */
const COLOR_RECRUITING = 0x5865f2;
const COLOR_CLOSED = 0x4b5563;

export class DiscordFeedError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DiscordFeedError";
  }
}

export interface CollabFeedConfig {
  channelId: string;
  guildId: string;
  botToken: string;
}

/**
 * The feed channel, or null when this deployment has none. Reads
 * `process.env` directly (not `@/env`) for the same reason the rest of the
 * Discord plumbing does: these are server-only values.
 */
export function collabFeedConfig(): CollabFeedConfig | null {
  const channelId = process.env.DISCORD_COLLAB_CHANNEL_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!channelId || !guildId || !botToken) return null;
  return { channelId, guildId, botToken };
}

export function collabFeedEnabled(): boolean {
  return collabFeedConfig() != null;
}

/** The link a client can open to read the mirrored message, in the app. */
export function collabFeedMessageUrl(
  guildId: string,
  channelId: string,
  messageId: string,
): string {
  return discordMessageLink(guildId, channelId, messageId);
}

/**
 * Every image URL in the payload, made absolute.
 *
 * Discord fetches embed images from its own servers, so a site-relative
 * path is not merely unrenderable — it fails the **whole message** with
 * `50035 / URL_TYPE_INVALID_URL`, and one bad thumbnail means nothing
 * posts. Stored images resolve to `/images/<key>` (see
 * `getProfileProjectImageUrl`), which is exactly that case. Anything that
 * still won't parse as http(s) is dropped rather than sent: a missing
 * thumbnail costs a little, a rejected message costs the whole share.
 */
function absoluteImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(siteUrl(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Everything the embed renders. Assembled by the router from the post row. */
export interface CollabFeedPost {
  id: number;
  title: string;
  description: string;
  type: string;
  status: string;
  compensationType: string | null;
  compensationMin: number | null;
  compensationMax: number | null;
  currency: string | null;
  projectName: string | null;
  createdAt: Date | string | null;
  expiresAt: Date | string | null;
  roles: string[];
  skills: string[];
  jam: { jamId: number; title: string; slug: string | null } | null;
  team: { id: string; name: string; slug: string | null; avatarUrl: string | null } | null;
  author: { name: string; avatarUrl: string | null; profilePath: string | null } | null;
  imageUrl: string | null;
}

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/**
 * A link button — component type 2, style 5.
 *
 * The one button kind that carries no `custom_id` and fires no
 * interaction: Discord just opens the URL. That is why the mirror can have
 * buttons at all while the web app listens on no gateway and the bot
 * service (`28`) stays a read client — nothing has to be *handled*.
 *
 * Discord validates these as http(s), so they lead to the site. That suits
 * them: the buttons are the call to action, and the action is here.
 */
interface DiscordLinkButton {
  type: 2;
  style: 5;
  label: string;
  url: string;
}

interface DiscordActionRow {
  type: 1;
  components: DiscordLinkButton[];
}

export interface DiscordMessagePayload {
  embeds: [
    {
      title: string;
      url: string;
      description: string;
      color: number;
      fields: DiscordEmbedField[];
      author?: { name: string; url?: string; icon_url?: string };
      thumbnail?: { url: string };
      footer: { text: string };
      timestamp?: string;
    },
  ];
  components: DiscordActionRow[];
  /**
   * Belt and braces. Mentions inside an embed never notify anyone, but the
   * body is user-written and this payload should stay safe if a `content`
   * line is ever added above it.
   */
  allowed_mentions: { parse: [] };
}

/** Discord's cap on a button label. */
const LABEL_MAX = 80;

/**
 * The row under the embed. An embed's title is a link, but it reads as
 * decoration — a member who wants to apply should have something obviously
 * pressable, and the primary one names the actual next step rather than
 * the destination.
 *
 * Ordered by how many people want each: apply, then the jam the post is
 * for, then the board it came from. Discord allows five per row; three is
 * already the point at which the row stops being a call to action.
 */
function feedButtons(post: CollabFeedPost, postUrl: string): DiscordActionRow[] {
  const isClosed = post.status !== "recruiting";
  const buttons: DiscordLinkButton[] = [
    {
      type: 2,
      style: 5,
      // A closed post's button must not still say "apply" — the page it
      // opens won't let them, and the embed above already says so.
      label: isClosed ? "View the post" : "Apply on Brackeys",
      url: postUrl,
    },
  ];

  if (post.jam) {
    buttons.push({
      type: 2,
      style: 5,
      label: truncate(`Jam: ${post.jam.title}`, LABEL_MAX),
      url: siteUrl(`/jams/${jamSlug(post.jam)}`),
    });
  }

  buttons.push({
    type: 2,
    style: 5,
    label: "All open posts",
    url: siteUrl("/collab"),
  });

  return [{ type: 1, components: buttons }];
}

/** `$25–$50/hr`, `HOBBY`, `REV SHARE` — one line for what the post pays. */
function rateLine(post: CollabFeedPost): string {
  const rate = formatRate(post.compensationType, post.compensationMin, post.compensationMax, {
    currency: post.currency,
    negotiableLabel: "Negotiable",
  });
  if (rate) return rate;
  return post.type === "paid" ? "Paid — terms not set" : "Hobby / unpaid";
}

/**
 * The embed, as a pure function of the post — so what lands in the channel
 * is testable without a Discord token.
 */
export function buildCollabFeedMessage(post: CollabFeedPost): DiscordMessagePayload {
  const url = siteUrl(`/collab/${post.id}`);
  const isClosed = post.status !== "recruiting";
  const thumbnailUrl = absoluteImageUrl(post.imageUrl);

  const fields: DiscordEmbedField[] = [];
  if (post.roles.length > 0) {
    fields.push({
      name: "Looking for",
      value: truncate(post.roles.join(" · "), FIELD_MAX),
      inline: false,
    });
  }
  if (post.skills.length > 0) {
    fields.push({
      name: "Stack",
      value: truncate(post.skills.join(" · "), FIELD_MAX),
      inline: false,
    });
  }
  fields.push({ name: "Terms", value: rateLine(post), inline: true });
  if (!isClosed && post.expiresAt) {
    // Discord's own relative timestamp, re-rendered by every client that
    // reads it. The lifecycle sweep expires posts from a worker that holds
    // no Discord credentials, so this is what keeps a mirror from claiming
    // to recruit months after the post stopped: the line reads "3 days ago"
    // on its own, and the link goes to the page that knows for certain.
    const closes = Math.floor(new Date(post.expiresAt).getTime() / 1000);
    fields.push({ name: "Closes", value: `<t:${closes}:R>`, inline: true });
  }
  if (post.jam) {
    fields.push({
      name: "Jam",
      // The site's jam page, not itch's: the embed's whole job is to lead
      // back here, and that page carries the other posts for the jam.
      value: `[${truncate(post.jam.title, 80)}](${siteUrl(`/jams/${jamSlug(post.jam)}`)})`,
      inline: true,
    });
  }
  if (isClosed) {
    fields.push({ name: "Status", value: "No longer recruiting", inline: true });
  }

  // A team post is posted *by the team*: the byline has to lead to the team
  // page, not to whichever member happened to press the button. Only a solo
  // post bylines the person.
  const byline = post.team
    ? {
        name: truncate(post.team.name, 200),
        url: siteUrl(`/teams/${teamSlug(post.team)}`),
        iconUrl: absoluteImageUrl(post.team.avatarUrl),
      }
    : post.author
      ? {
          name: truncate(post.author.name, 200),
          url: post.author.profilePath ? siteUrl(post.author.profilePath) : null,
          iconUrl: absoluteImageUrl(post.author.avatarUrl),
        }
      : null;

  return {
    embeds: [
      {
        title: truncate(post.title, TITLE_MAX),
        url,
        description: truncate(post.description, DESCRIPTION_MAX),
        color: isClosed ? COLOR_CLOSED : COLOR_RECRUITING,
        fields,
        ...(byline
          ? {
              author: {
                name: byline.name,
                ...(byline.url ? { url: byline.url } : {}),
                ...(byline.iconUrl ? { icon_url: byline.iconUrl } : {}),
              },
            }
          : {}),
        ...(thumbnailUrl ? { thumbnail: { url: thumbnailUrl } } : {}),
        // Attribution now that the button below carries the call to
        // action. Still worth saying: applications are read, tracked and
        // answered on the site, and a Discord reply reaches nobody.
        footer: { text: "Brackeys collab board" },
        ...(post.createdAt ? { timestamp: new Date(post.createdAt).toISOString() } : {}),
      },
    ],
    components: feedButtons(post, url),
    allowed_mentions: { parse: [] },
  };
}

function authHeaders(config: CollabFeedConfig): Record<string, string> {
  return { Authorization: `Bot ${config.botToken}` };
}

async function failure(response: Response, action: string): Promise<DiscordFeedError> {
  const body = await response.text().catch(() => "");
  return new DiscordFeedError(
    `Discord refused to ${action} the collab message: ${response.status} ${body.slice(0, 200)}`,
    response.status,
  );
}

/** Posts the embed and returns the message id to remember it by. */
export async function postCollabFeedMessage(
  config: CollabFeedConfig,
  payload: DiscordMessagePayload,
): Promise<string> {
  const response = await discordWriteFetch(
    `https://discord.com/api/v10/channels/${config.channelId}/messages`,
    { method: "POST", headers: authHeaders(config), body: payload },
  );
  if (!response.ok) throw await failure(response, "post");
  const message = (await response.json()) as { id?: string };
  if (!message.id) throw new DiscordFeedError("Discord accepted the message but returned no id");
  return message.id;
}

/**
 * Rewrites an existing mirror in place. `"gone"` means the message no longer
 * exists — a moderator tidied the channel, or it was posted before the
 * channel moved — which callers answer by posting a fresh one rather than
 * failing the action.
 */
export async function editCollabFeedMessage(
  config: CollabFeedConfig,
  channelId: string,
  messageId: string,
  payload: DiscordMessagePayload,
): Promise<"edited" | "gone"> {
  const response = await discordWriteFetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    { method: "PATCH", headers: authHeaders(config), body: payload },
  );
  if (response.ok) return "edited";
  if (response.status === 404) return "gone";
  throw await failure(response, "edit");
}

/** Removes a mirror. A message that is already gone counts as removed. */
export async function deleteCollabFeedMessage(
  config: CollabFeedConfig,
  channelId: string,
  messageId: string,
): Promise<void> {
  const response = await discordWriteFetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    { method: "DELETE", headers: authHeaders(config) },
  );
  if (!response.ok && response.status !== 404) throw await failure(response, "delete");
}
