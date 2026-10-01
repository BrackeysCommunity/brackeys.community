import { describe, expect, it } from "vite-plus/test";

import { parseWikilink, wikilinkLabel, wikilinkMatches } from "../wikilinks";

describe("parseWikilink", () => {
  it("reads targets, headings, blocks, aliases and embeds", () => {
    expect(parseWikilink("[[Design/Level ideas.md|ideas]] rest")).toEqual({
      raw: "[[Design/Level ideas.md|ideas]]",
      link: { target: "Design/Level ideas.md", subpath: undefined, alias: "ideas", embed: false },
    });
    expect(parseWikilink("[[Boss#Phase 2]]")?.link).toMatchObject({
      target: "Boss",
      subpath: "#Phase 2",
    });
    expect(parseWikilink("[[Boss^abc123]]")?.link.subpath).toBe("^abc123");
    expect(parseWikilink("![[boss.png]]")?.link).toMatchObject({ target: "boss.png", embed: true });
  });

  it("refuses what isn't a link at the start", () => {
    expect(parseWikilink("see [[Boss]]")).toBeNull();
    expect(parseWikilink("[[]]")).toBeNull();
    expect(parseWikilink("[[#only a heading]]")).toBeNull();
    expect(parseWikilink("[[two\nlines]]")).toBeNull();
  });
});

describe("wikilinkMatches", () => {
  it("matches by name in any folder, or by a path suffix, ignoring case and .md", () => {
    expect(wikilinkMatches("Boss", "Design/boss.md")).toBe(true);
    expect(wikilinkMatches("design/Boss.md", "Design/Boss.md")).toBe(true);
    expect(wikilinkMatches("boss.png", "attachments/boss.png")).toBe(true);
    expect(wikilinkMatches("Boss", "Design/Big Boss.md")).toBe(false);
    expect(wikilinkMatches("Art/Boss", "Design/Boss.md")).toBe(false);
  });
});

describe("wikilinkLabel", () => {
  it("prefers the alias, else the name with its heading", () => {
    expect(wikilinkLabel({ target: "a/Boss.md", alias: "the boss", embed: false })).toBe(
      "the boss",
    );
    expect(wikilinkLabel({ target: "a/Boss.md", subpath: "#Phase 2", embed: false })).toBe(
      "Boss › Phase 2",
    );
  });
});
