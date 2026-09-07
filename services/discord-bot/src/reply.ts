/**
 * What a command answers with, as plain data. Commands build one of these
 * and never see a discord.js interaction; `discord/adapter.ts` is the only
 * file that turns it into a message. That split is what lets the command
 * layer run under `bun test` against a fake API with a fixed clock.
 */

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  image?: string;
  thumbnail?: string;
  footer?: string;
  author?: { name: string; url?: string; iconUrl?: string };
}

export type Button =
  | { kind: "link"; label: string; url: string }
  | { kind: "page"; label: string; customId: string; disabled?: boolean };

export interface Reply {
  content?: string;
  embeds: Embed[];
  buttons: Button[];
  ephemeral: boolean;
  /** What the API said, for the command telemetry. Thrown errors carry the
   *  other two outcomes. */
  outcome: "hit" | "not_found";
}

// Discord's embed limits.
export const EMBED_TITLE_MAX = 256;
export const EMBED_DESCRIPTION_MAX = 4096;
export const EMBED_FIELD_NAME_MAX = 256;
export const EMBED_FIELD_VALUE_MAX = 1024;
export const EMBED_FIELDS_MAX = 25;
export const EMBED_FOOTER_MAX = 2048;
export const EMBED_AUTHOR_MAX = 256;
export const EMBED_TOTAL_MAX = 6000;
export const BUTTON_LABEL_MAX = 80;

/** Characters Discord counts against an embed's 6000 budget. */
export function embedLength(embed: Embed): number {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0)
  );
}

/** Cut to `max` characters with a single ellipsis, never splitting a
 *  surrogate pair. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = Math.max(0, max - 1);
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut).trimEnd()}…`;
}

/** One-line prose: newlines collapse so a scraped blurb stays a row. */
export function oneLine(text: string | null | undefined, max: number): string {
  if (!text) return "";
  return truncate(text.replace(/\s+/g, " ").trim(), max);
}

/**
 * Discord rejects the whole message (50035 `URL_TYPE_INVALID_URL`) if any
 * embed URL is not absolute http(s), and the public API returns
 * site-relative paths for anything uploaded to the site. Call sites
 * absolutize first (`mediaUrl` in `commands/format.ts`); this is the
 * backstop that turns anything still malformed into a missing image
 * rather than a failed command.
 */
export function httpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The site as a member knows it — `brackeys.community` in prod,
 * `staging.brackeys.dev` on staging. Every user-facing mention of the site
 * derives from `APP_URL` through this, so the copy cannot name a domain the
 * bot is not actually talking to.
 */
export function siteName(appUrl: string): string {
  try {
    return new URL(appUrl).host.replace(/^www\./, "");
  } catch {
    return appUrl;
  }
}

/** Markdown link with a label that cannot break out of the brackets. */
export function link(label: string, url: string): string {
  const safe = label.replace(/[[\]]/g, "").replace(/\\/g, "") || "link";
  return `[${safe}](${url})`;
}

export type TimestampStyle = "R" | "D" | "d" | "f" | "F" | "t" | "T";

/**
 * Discord renders `<t:unix:R>` in each reader's own zone, which is why no
 * jam date in this service ever goes through `toLocaleString`.
 */
export function ts(date: Date | string, style: TimestampStyle = "R"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
}

/** `#rrggbb` (with or without the hash) → the integer Discord wants. */
export function hexColor(hex: string | null | undefined): number | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? Number.parseInt(m[1]!, 16) : undefined;
}

/**
 * Enforce every per-part limit on one embed. Listings stay under the 6000
 * total by construction (ten rows, truncated blurbs); this is the backstop
 * that keeps a single pathological title from failing the whole reply.
 */
export function clampEmbed(embed: Embed): Embed {
  const out: Embed = { ...embed };
  out.url = httpUrl(out.url);
  out.image = httpUrl(out.image);
  out.thumbnail = httpUrl(out.thumbnail);
  if (out.author) {
    out.author = {
      ...out.author,
      url: httpUrl(out.author.url),
      iconUrl: httpUrl(out.author.iconUrl),
    };
  }
  if (out.title) out.title = truncate(out.title, EMBED_TITLE_MAX);
  if (out.description) out.description = truncate(out.description, EMBED_DESCRIPTION_MAX);
  if (out.footer) out.footer = truncate(out.footer, EMBED_FOOTER_MAX);
  if (out.author) out.author = { ...out.author, name: truncate(out.author.name, EMBED_AUTHOR_MAX) };
  if (out.fields) {
    out.fields = out.fields.slice(0, EMBED_FIELDS_MAX).map((f) => ({
      ...f,
      name: truncate(f.name, EMBED_FIELD_NAME_MAX) || "\u200b",
      value: truncate(f.value, EMBED_FIELD_VALUE_MAX) || "\u200b",
    }));
  }
  // Still over the total after per-part clamps: shorten the description,
  // then drop trailing fields. Rare enough that losing rows beats failing.
  while (embedLength(out) > EMBED_TOTAL_MAX) {
    if (out.description && out.description.length > 200) {
      out.description = truncate(out.description, Math.floor(out.description.length / 2));
    } else if (out.fields && out.fields.length > 0) {
      out.fields = out.fields.slice(0, -1);
    } else {
      out.title = truncate(out.title ?? "", 64);
      break;
    }
  }
  return out;
}

export function embedReply(
  embed: Embed,
  options: { buttons?: Button[]; ephemeral: boolean; outcome?: Reply["outcome"] },
): Reply {
  return {
    embeds: [clampEmbed(embed)],
    buttons: options.buttons ?? [],
    ephemeral: options.ephemeral,
    outcome: options.outcome ?? "hit",
  };
}

/** A short ephemeral line — "no such jam", "run the command again". */
export function textReply(content: string, outcome: Reply["outcome"] = "hit"): Reply {
  return { content, embeds: [], buttons: [], ephemeral: true, outcome };
}

export function notFound(content: string): Reply {
  return textReply(content, "not_found");
}

/** Pluralise the boring way; every count in an embed goes through it. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? singular : pluralForm}`;
}
