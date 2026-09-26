import { describe, expect, it } from "vite-plus/test";

import { markdownToParagraphs, markdownToPlainText } from "@/lib/markdown-text";

describe("markdownToParagraphs", () => {
  it("returns nothing for empty input", () => {
    expect(markdownToParagraphs(null)).toEqual([]);
    expect(markdownToParagraphs("")).toEqual([]);
    expect(markdownToParagraphs("   \n  ")).toEqual([]);
  });

  it("drops heading marks and keeps the words", () => {
    expect(markdownToParagraphs("## About the Work\n\nWe need a **composer**.")).toEqual([
      "About the Work",
      "We need a composer.",
    ]);
  });

  it("keeps link text, list items and table cells; drops images, fences and rules", () => {
    const md = [
      "See [the brief](https://example.com) first.",
      "",
      "- one",
      "- *two*",
      "",
      "---",
      "",
      "```",
      "const nope = 1;",
      "```",
      "",
      "![cover](https://example.com/c.png)",
      "",
      "| Rate | Notes |",
      "| --- | --- |",
      "| $50 | jam work |",
    ].join("\n");
    expect(markdownToParagraphs(md)).toEqual([
      "See the brief first.",
      "one two",
      "Rate Notes $50 jam work",
    ]);
  });

  it("reduces raw html rather than dropping it, for pre-markdown rows", () => {
    expect(markdownToParagraphs("<p>Short jam project, <b>three</b> weeks.</p>")).toEqual([
      "Short jam project, three weeks.",
    ]);
  });
});

describe("markdownToPlainText", () => {
  it("joins paragraphs and clips on a word boundary", () => {
    const text = markdownToPlainText("# Title\n\nsome words that run on for a while", 24);
    expect(text).toBe("Title some words that…");
  });

  it("is undefined for empty input", () => {
    expect(markdownToPlainText("")).toBeUndefined();
  });
});

describe("guild emojis in plain text", () => {
  it("reads as the emoji's name", () => {
    expect(markdownToPlainText("ship it <a:party:998877665544332211>")).toBe("ship it :party:");
  });

  it("keeps the tokens for Discord when asked", () => {
    expect(
      markdownToPlainText("**ship** it <a:party:998877665544332211>", 200, {
        keepDiscordTokens: true,
      }),
    ).toBe("ship it <a:party:998877665544332211>");
  });

  it("never clips inside a token", () => {
    const text = `${"word ".repeat(8)}<:fire:123456789012345678>`;
    expect(markdownToPlainText(text, 50, { keepDiscordTokens: true })).toBe(
      `${"word ".repeat(8).trim()}…`,
    );
  });
});

describe("channel mentions in plain text", () => {
  it("reads as a generic #channel", () => {
    expect(markdownToPlainText("ask in <#552209553886806046>")).toBe("ask in #channel");
  });

  it("keeps the token for Discord and never clips inside one", () => {
    expect(markdownToPlainText("see <#552209553886806046>", 200, { keepDiscordTokens: true })).toBe(
      "see <#552209553886806046>",
    );
    const text = `${"word ".repeat(8)}<#552209553886806046>`;
    expect(markdownToPlainText(text, 50, { keepDiscordTokens: true })).toBe(
      `${"word ".repeat(8).trim()}…`,
    );
  });
});
