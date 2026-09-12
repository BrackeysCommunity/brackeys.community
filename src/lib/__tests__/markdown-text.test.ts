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
