/**
 * Standard emojis by Discord-style shortcode (`:fire:` → 🔥). The table is
 * generated (`bun run emoji:generate`) and loaded on first use, so it stays
 * out of every bundle that never opens the picker.
 */

export interface UnicodeEmoji {
  emoji: string;
  shortcodes: string[];
}

export interface UnicodeEmojiMatch {
  emoji: string;
  /** The shortcode that matched, shown in the picker. */
  shortcode: string;
}

let table: Promise<UnicodeEmoji[]> | null = null;

export function loadUnicodeEmojis(): Promise<UnicodeEmoji[]> {
  table ??= import("./unicode-emoji.json").then((mod) =>
    (mod.default as string[][]).map(([emoji, ...shortcodes]) => ({
      emoji: emoji!,
      shortcodes,
    })),
  );
  return table;
}

function rank(code: string, query: string): number {
  return code === query ? -1 : code.length;
}

/** Exact, then prefix (shortest first), then substring matches. */
export function filterUnicodeEmojis(
  emojis: UnicodeEmoji[],
  query: string,
  limit = 8,
): UnicodeEmojiMatch[] {
  const q = query.toLowerCase();
  const prefix: UnicodeEmojiMatch[] = [];
  const inner: UnicodeEmojiMatch[] = [];
  for (const { emoji, shortcodes } of emojis) {
    const starts = shortcodes.find((code) => code.startsWith(q));
    if (starts) prefix.push({ emoji, shortcode: starts });
    else {
      const contains = shortcodes.find((code) => code.includes(q));
      if (contains) inner.push({ emoji, shortcode: contains });
    }
  }
  return [...prefix.sort((a, b) => rank(a.shortcode, q) - rank(b.shortcode, q)), ...inner].slice(
    0,
    limit,
  );
}

export function unicodeEmojiFor(emojis: UnicodeEmoji[], shortcode: string): string | null {
  const code = shortcode.toLowerCase();
  return emojis.find((e) => e.shortcodes.includes(code))?.emoji ?? null;
}
