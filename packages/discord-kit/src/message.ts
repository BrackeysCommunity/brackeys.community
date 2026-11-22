import { BUTTON_LABEL_MAX, type Button, type Embed, httpUrl } from "./embed.ts";

/**
 * Messages as the raw JSON an interaction answers with; discord.js accepts
 * it as is, so this file needs no dependency.
 */

/** A select menu the bot answers through its custom id. */
export interface Select {
  customId: string;
  placeholder: string;
  options: { label: string; value: string; description?: string; default?: boolean }[];
  disabled?: boolean;
}

/** A file sent with the message; an embed shows it as `attachment://name`. */
export interface Attachment {
  name: string;
  data: Uint8Array;
  description?: string;
}

/** Buttons go five to a row; a select takes a row of its own. */
export type Row = { buttons: Button[] } | { select: Select };

export interface Message {
  content?: string;
  embeds: Embed[];
  rows: Row[];
  files?: Attachment[];
  /** The only role ids the message may ping; it pings nobody else. */
  mentionRoles?: string[];
}

const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 } as const;
const COMPONENT = { row: 1, button: 2, select: 3 } as const;
export const ROWS_MAX = 5;
export const PER_ROW = 5;
export const OPTIONS_MAX = 25;
export const SELECT_LABEL_MAX = 100;
export const SELECT_VALUE_MAX = 100;

export interface MessageJson {
  content: string;
  embeds: Record<string, unknown>[];
  components: Record<string, unknown>[];
  files?: { name: string; attachment: Buffer; description?: string }[];
  allowedMentions: { parse: []; roles?: string[] };
}

/** Buttons as rows of five, as Message rows. */
export function buttonRows(buttons: Button[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < buttons.length; i += PER_ROW)
    rows.push({ buttons: buttons.slice(i, i + PER_ROW) });
  return rows;
}

/**
 * The message's JSON. A link button with a malformed URL, or a second use
 * of a custom id, is dropped rather than failing the whole message; rows
 * past Discord's five are dropped too.
 */
export function toMessage(message: Message): MessageJson {
  const seen = new Set<string>();
  const components: Record<string, unknown>[] = [];
  for (const row of message.rows) {
    if (components.length >= ROWS_MAX) break;
    if ("select" in row) {
      const s = row.select;
      if (seen.has(s.customId) || s.options.length === 0) continue;
      seen.add(s.customId);
      components.push({
        type: COMPONENT.row,
        components: [
          {
            type: COMPONENT.select,
            custom_id: s.customId,
            placeholder: s.placeholder.slice(0, 150),
            disabled: s.disabled ?? false,
            options: s.options.slice(0, OPTIONS_MAX).map((o) => ({
              label: o.label.slice(0, SELECT_LABEL_MAX),
              value: o.value,
              description: o.description?.slice(0, SELECT_LABEL_MAX),
              default: o.default ?? false,
            })),
          },
        ],
      });
      continue;
    }
    const buttons = row.buttons
      .filter((b) => {
        if (b.kind === "link") return /^https?:/.test(httpUrl(b.url) ?? "");
        if (seen.has(b.customId)) return false;
        seen.add(b.customId);
        return true;
      })
      .slice(0, PER_ROW)
      .map((b) =>
        b.kind === "link"
          ? {
              type: COMPONENT.button,
              style: STYLE.link,
              label: b.label.slice(0, BUTTON_LABEL_MAX),
              url: b.url,
            }
          : {
              type: COMPONENT.button,
              style: STYLE[b.style ?? "secondary"],
              label: b.label.slice(0, BUTTON_LABEL_MAX),
              custom_id: b.customId,
              disabled: b.disabled ?? false,
              ...(b.emoji ? { emoji: { name: b.emoji } } : {}),
            },
      );
    if (buttons.length > 0) components.push({ type: COMPONENT.row, components: buttons });
  }
  const out: MessageJson = {
    content: message.content ?? "",
    embeds: message.embeds.map(toApiEmbed),
    components,
    // Ping nobody from a bot answer, whatever its text contains, except mentionRoles.
    allowedMentions: message.mentionRoles?.length
      ? { parse: [], roles: [...new Set(message.mentionRoles)] }
      : { parse: [] },
  };
  if (message.files?.length) {
    out.files = message.files.map((f) => ({
      name: f.name,
      attachment: Buffer.from(f.data),
      description: f.description,
    }));
  }
  return out;
}

function toApiEmbed(embed: Embed): Record<string, unknown> {
  return {
    title: embed.title,
    url: embed.url,
    description: embed.description,
    color: embed.color,
    fields: embed.fields,
    image: embed.image ? { url: embed.image } : undefined,
    thumbnail: embed.thumbnail ? { url: embed.thumbnail } : undefined,
    footer: embed.footer ? { text: embed.footer } : undefined,
    author: embed.author
      ? { name: embed.author.name, url: embed.author.url, icon_url: embed.author.iconUrl }
      : undefined,
  };
}
