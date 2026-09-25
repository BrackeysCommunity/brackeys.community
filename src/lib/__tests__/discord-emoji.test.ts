import { marked } from "marked";
import { describe, expect, it } from "vite-plus/test";

import { emojiToken, emojiTokensToNames, filterEmojis } from "@/lib/discord-emoji";

const fire = { id: "123456789012345678", name: "fire", animated: false };
const party = { id: "998877665544332211", name: "party", animated: true };

describe("emoji tokens", () => {
  it("writes Discord's own format", () => {
    expect(emojiToken(fire)).toBe("<:fire:123456789012345678>");
    expect(emojiToken(party)).toBe("<a:party:998877665544332211>");
  });

  it("turns tokens into names outside code", () => {
    expect(emojiTokensToNames("hot <:fire:123456789012345678>!")).toBe("hot :fire:!");
    expect(emojiTokensToNames("`<:fire:123456789012345678>`")).toBe("`<:fire:123456789012345678>`");
  });

  it("passes through marked as plain text, not HTML or an autolink", () => {
    const [paragraph] = marked.lexer(
      "hi <:fire:123456789012345678> **<a:party:998877665544332211>**",
    );
    const types = (paragraph as { tokens: { type: string; raw: string }[] }).tokens.map(
      (t) => [t.type, t.raw] as const,
    );
    expect(types).toEqual([
      ["text", "hi <:fire:123456789012345678> "],
      ["strong", "**<a:party:998877665544332211>**"],
    ]);
  });
});

describe("filterEmojis", () => {
  const list = [
    { id: "1", name: "campfire", animated: false },
    { id: "2", name: "fire", animated: false },
    { id: "3", name: "Firefox", animated: false },
  ];

  it("ranks prefix matches first, case-insensitively", () => {
    expect(filterEmojis(list, "fire").map((e) => e.name)).toEqual(["fire", "Firefox", "campfire"]);
  });

  it("caps the list", () => {
    expect(filterEmojis(list, "f", 1)).toHaveLength(1);
  });
});
