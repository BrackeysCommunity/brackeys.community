/**
 * `discord:component-embed` — the JSON payload Discord reads off a page to
 * replace the standard link preview with a Components V2 layout.
 *
 * Display-only. Link buttons are the only interactive part, nothing sends
 * an interaction, and none of this goes through the bot: any member pasting
 * a brackeys.community link gets the layout, in any server.
 *
 * The Open Graph tags `site-meta.ts` builds stay exactly as they are — they
 * are what Discord falls back to whenever this payload is absent, malformed
 * or over a limit. That fallback is why every builder here returns `null`
 * (and `componentEmbed` returns no script at all) rather than emitting
 * something Discord will reject: a dropped payload costs us the custom
 * layout, a bad one would cost us the preview.
 *
 * The shapes are narrowed by hand instead of lifted from a Discord types
 * package: a component embed forbids `id`, `custom_id` and every non-link
 * button style, and a type that cannot express those cannot ship them.
 *
 * https://discord.com/developers/docs/link-previews/component-embeds
 */

export interface DiscordEmoji {
  id?: string;
  name?: string;
  animated?: boolean;
}

export interface LinkButton {
  type: 2;
  style: 5;
  url: string;
  label?: string;
  emoji?: DiscordEmoji;
  disabled?: boolean;
}

export interface TextDisplay {
  type: 10;
  content: string;
}

export interface UnfurledMedia {
  url: string;
}

export interface Thumbnail {
  type: 11;
  media: UnfurledMedia;
  description?: string;
  spoiler?: boolean;
}

export interface MediaGalleryItem {
  media: UnfurledMedia;
  description?: string;
  spoiler?: boolean;
}

export interface MediaGallery {
  type: 12;
  items: MediaGalleryItem[];
}

export interface Separator {
  type: 14;
  divider?: boolean;
  spacing?: 1 | 2;
}

export interface ActionRow {
  type: 1;
  components: LinkButton[];
}

export interface Section {
  type: 9;
  components: TextDisplay[];
  accessory: LinkButton | Thumbnail;
}

export type ContainerChild = ActionRow | Section | TextDisplay | MediaGallery | Separator;

export interface Container {
  type: 17;
  accent_color?: number;
  spoiler?: boolean;
  components: ContainerChild[];
}

/** Documented cap on the whole payload, container included. */
const MAX_COMPONENTS = 40;

const MAX_URL_LENGTH = 2048;

/**
 * Documented for the `<link>` form only; the inline `<script>` has no
 * stated cap. Held to the smaller number either way so switching delivery
 * later is a one-line change rather than a re-think of every payload.
 */
const MAX_PAYLOAD_BYTES = 3000;

/** Gallery ceiling. Matches the four-image cap on standard previews. */
export const MAX_GALLERY_ITEMS = 4;

/** `--color-brackeys-yellow`, the accent bar for anything with no color of
 *  its own. */
export const BRAND_ACCENT = 0xffa949;

/**
 * Collab post accents — Brackeys purple while a post recruits, muted grey
 * once it stops. Shared with the feed mirror (`collab-discord-feed.ts`) so
 * the same post reads the same whether it was shared into a channel or
 * merely linked there.
 */
export const ACCENT_RECRUITING = 0x5865f2;
export const ACCENT_CLOSED = 0x4b5563;

const TEXT_DISPLAY_LIMIT = 4000;

/**
 * `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb()/rgba()` to the integer the
 * container wants. Alpha is dropped — an accent bar has no transparency.
 * Broad on input because scraped jam theme colors arrive in every one of
 * these forms (see `safeThemeColor`).
 */
export function accentColor(css: string | null | undefined): number | undefined {
  if (!css) return undefined;
  const value = css.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    const digits = hex[1]!;
    const rgb =
      digits.length === 3
        ? digits
            .split("")
            .map((d) => d + d)
            .join("")
        : digits.slice(0, 6);
    return Number.parseInt(rgb, 16);
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(
    value,
  );
  if (!rgb) return undefined;
  const channels = rgb.slice(1, 4).map((n) => Math.round(Number(n)));
  if (channels.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return undefined;
  return (channels[0]! << 16) | (channels[1]! << 8) | channels[2]!;
}

const MARKDOWN_SPECIAL = /[\\*_~`|]/g;

/** Neutralize markdown in text we did not write — post titles, jam titles. */
export function mdEscape(text: string): string {
  return text.replace(MARKDOWN_SPECIAL, (char) => `\\${char}`);
}

/** Markdown link whose label cannot break out of the brackets. */
export function mdLink(label: string, url: string): string {
  const safe = mdEscape(label.replace(/[[\]]/g, "")).trim();
  return `[${safe || "link"}](${url})`;
}

export function clampText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function validUrl(url: string | null | undefined): string | null {
  if (!url || url.length > MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function textDisplay(content: string | null | undefined): TextDisplay | null {
  const trimmed = content?.trim();
  return trimmed ? { type: 10, content: clampText(trimmed, TEXT_DISPLAY_LIMIT) } : null;
}

export function linkButton(
  label: string,
  url: string | null | undefined,
  options: { emoji?: DiscordEmoji; disabled?: boolean } = {},
): LinkButton | null {
  const href = validUrl(url);
  // A button needs a label, an emoji, or both — never neither.
  const text = label.trim();
  if (!href || (!text && !options.emoji)) return null;
  return {
    type: 2,
    style: 5,
    url: href,
    ...(text ? { label: clampText(text, 80) } : {}),
    ...(options.emoji ? { emoji: options.emoji } : {}),
    ...(options.disabled ? { disabled: true } : {}),
  };
}

export function actionRow(buttons: (LinkButton | null)[]): ActionRow | null {
  const present = buttons.filter((button): button is LinkButton => button != null).slice(0, 5);
  return present.length > 0 ? { type: 1, components: present } : null;
}

export function thumbnail(
  url: string | null | undefined,
  options: { description?: string | null; spoiler?: boolean } = {},
): Thumbnail | null {
  const href = validUrl(url);
  if (!href) return null;
  return {
    type: 11,
    media: { url: href },
    ...(options.description ? { description: clampText(options.description, 1024) } : {}),
    ...(options.spoiler ? { spoiler: true } : {}),
  };
}

export function mediaGallery(
  sources: { url: string | null | undefined; description?: string | null }[],
): MediaGallery | null {
  const items = sources
    .map(({ url, description }) => {
      const href = validUrl(url);
      if (!href) return null;
      return {
        media: { url: href },
        ...(description ? { description: clampText(description, 1024) } : {}),
      } satisfies MediaGalleryItem;
    })
    .filter((item): item is MediaGalleryItem => item != null)
    .slice(0, MAX_GALLERY_ITEMS);
  return items.length > 0 ? { type: 12, items } : null;
}

export function separator(options: { divider?: boolean; spacing?: 1 | 2 } = {}): Separator {
  return {
    type: 14,
    ...(options.divider === false ? { divider: false } : {}),
    ...(options.spacing ? { spacing: options.spacing } : {}),
  };
}

/**
 * Text with something beside it. Degrades to the bare text when the
 * accessory could not be built — a section without one is invalid, and the
 * text is the part worth keeping.
 */
export function section(
  text: TextDisplay | null,
  accessory: LinkButton | Thumbnail | null,
): Section | TextDisplay | null {
  if (!text) return null;
  return accessory ? { type: 9, components: [text], accessory } : text;
}

export function container(
  children: (ContainerChild | null)[],
  options: { accent?: number; spoiler?: boolean } = {},
): Container | null {
  const components = children.filter((child): child is ContainerChild => child != null);
  if (components.length === 0) return null;
  return {
    type: 17,
    ...(options.accent != null ? { accent_color: options.accent } : {}),
    ...(options.spoiler ? { spoiler: true } : {}),
    components,
  };
}

function countComponents(node: Container | ContainerChild | LinkButton | Thumbnail): number {
  switch (node.type) {
    case 9:
      return 1 + node.components.length + countComponents(node.accessory);
    case 1:
    case 17:
      return 1 + node.components.reduce((sum, child) => sum + countComponents(child), 0);
    default:
      return 1;
  }
}

/**
 * The head `<script>` Discord looks for, as a TanStack head-scripts entry.
 * Sits beside `jsonLd` in a route's `scripts` array and escapes `<` the
 * same way — the only character that can close the element early.
 */
export function componentEmbed(
  root: Container | null,
): { id: string; type: string; children: string }[] {
  if (!root || countComponents(root) > MAX_COMPONENTS) return [];

  const children = JSON.stringify({ component: root }).replaceAll("<", "\\u003c");
  // Byte length, not character count: the limit is on the raw bytes, and a
  // title full of CJK or emoji is several bytes per character.
  if (new TextEncoder().encode(children).length > MAX_PAYLOAD_BYTES) return [];

  return [{ id: "discord:component-embed", type: "application/json", children }];
}
