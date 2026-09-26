/**
 * Guild custom emojis in member-written text. Bodies store Discord's own
 * token, `<:name:id>` or `<a:name:id>`, so the Discord mirrors post them
 * untouched and a renamed emoji keeps rendering. Pure and client-safe.
 */

export interface GuildEmoji {
  id: string;
  name: string;
  animated: boolean;
}

export const EMOJI_TOKEN_PATTERN = /<(a?):(\w{2,32}):(\d{17,20})>/g;

export function emojiToken(emoji: GuildEmoji): string {
  return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}

export function emojiUrl(emoji: Pick<GuildEmoji, "id" | "animated">, size = 48): string {
  return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "webp"}?size=${size}`;
}

/** `<:name:id>` → `:name:` outside code, for plain-text surfaces and the editor. */
export function emojiTokensToNames(text: string): string {
  return outsideCode(text, (part) =>
    part.replace(EMOJI_TOKEN_PATTERN, (_, _a, name: string) => `:${name}:`),
  );
}

/** Case-insensitive: exact, then prefix (shortest first), then substring matches. */
export function filterEmojis(emojis: GuildEmoji[], query: string, limit = 8): GuildEmoji[] {
  const q = query.toLowerCase();
  const prefix: GuildEmoji[] = [];
  const inner: GuildEmoji[] = [];
  for (const emoji of emojis) {
    const name = emoji.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(emoji);
    else if (name.includes(q)) inner.push(emoji);
  }
  const rank = (e: GuildEmoji) => (e.name.toLowerCase() === q ? -1 : e.name.length);
  return [...prefix.sort((a, b) => rank(a) - rank(b)), ...inner].slice(0, limit);
}

const CODE_PATTERN = /(```[\s\S]*?```|`[^`\n]*`)/;

function outsideCode(text: string, transform: (part: string) => string): string {
  return text
    .split(CODE_PATTERN)
    .map((part, i) => (i % 2 === 1 ? part : transform(part)))
    .join("");
}

const PARTIAL_TOKEN = /<(?:a?:\w*(?::\d*)?|a|#\d*)?$/;

/**
 * Drops an emoji or channel token cut in half at the end of `text`, for
 * any clip that feeds Discord: a dangling `<:fi` or `<#5522` renders as
 * raw text there.
 */
export function trimPartialEmojiToken(text: string): string {
  const match = PARTIAL_TOKEN.exec(text);
  return match ? text.slice(0, match.index) : text;
}
