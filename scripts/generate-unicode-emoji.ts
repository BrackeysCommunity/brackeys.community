/**
 * Writes `src/lib/unicode-emoji.json`: every emoji with a Slack/Discord
 * style shortcode (`:fire:`, `:+1:`), in emojibase order, as
 * `[emoji, ...shortcodes]`. Rerun after bumping `emojibase-data`:
 *
 *   bun run emoji:generate
 */
import { writeFileSync } from "node:fs";

import compact from "emojibase-data/en/compact.json" with { type: "json" };
import iamcal from "emojibase-data/en/shortcodes/iamcal.json" with { type: "json" };

const shortcodes = iamcal as Record<string, string | string[]>;

const rows = [...compact]
  .filter((emoji) => emoji.order !== undefined && shortcodes[emoji.hexcode])
  .sort((a, b) => a.order! - b.order!)
  .map((emoji) => {
    const codes = shortcodes[emoji.hexcode]!;
    return [emoji.unicode, ...(Array.isArray(codes) ? codes : [codes])];
  });

writeFileSync(
  new URL("../src/lib/unicode-emoji.json", import.meta.url),
  `${JSON.stringify(rows)}\n`,
);
console.log(`wrote ${rows.length} emojis`);
