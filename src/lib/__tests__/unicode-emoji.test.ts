import { describe, expect, it } from "vite-plus/test";

import { filterUnicodeEmojis, loadUnicodeEmojis, unicodeEmojiFor } from "@/lib/unicode-emoji";

describe("standard emoji shortcodes", () => {
  it("knows Discord's names", async () => {
    const emojis = await loadUnicodeEmojis();
    expect(unicodeEmojiFor(emojis, "fire")).toBe("🔥");
    expect(unicodeEmojiFor(emojis, "joy")).toBe("😂");
    expect(unicodeEmojiFor(emojis, "+1")).toMatch(/^👍/);
    expect(unicodeEmojiFor(emojis, "not_an_emoji")).toBeNull();
  });

  it("ranks prefix matches first and caps the list", async () => {
    const emojis = await loadUnicodeEmojis();
    const matches = filterUnicodeEmojis(emojis, "fir", 3);
    expect(matches).toHaveLength(3);
    expect(matches.every((m) => m.shortcode.startsWith("fir"))).toBe(true);
    expect(matches[0]!.shortcode).toBe("fire");
  });
});
