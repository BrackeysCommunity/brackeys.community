import { describe, expect, test } from "bun:test";

import { matchNsfwTags, parseGameTags } from "./game-tags.ts";

describe("parseGameTags", () => {
  test("reads the tags array from a game payload", () => {
    expect(
      parseGameTags({ id: 3361070, title: "x", tags: ["adult", "roguelike", "nsfw"] }),
    ).toEqual(["adult", "roguelike", "nsfw"]);
  });

  test("an untagged game is a verdict, not a failure", () => {
    expect(parseGameTags({ id: 1, title: "x" })).toEqual([]);
  });

  test("drops non-string entries instead of failing the payload", () => {
    expect(parseGameTags({ tags: ["adult", 7, null, { url: "/soundtracks" }] })).toEqual(["adult"]);
  });

  test("itch error bodies and non-objects yield no verdict", () => {
    expect(parseGameTags({ errors: ["invalid game"] })).toBeNull();
    expect(parseGameTags("<!doctype html>")).toBeNull();
    expect(parseGameTags(null)).toBeNull();
  });
});

describe("matchNsfwTags", () => {
  test("picks the adult slugs, preserving order", () => {
    expect(matchNsfwTags(["2d", "adult", "furry", "erotic", "nsfw", "roguelike"])).toEqual([
      "adult",
      "erotic",
      "nsfw",
    ]);
  });

  test("matches whole slugs only — no substring reach", () => {
    expect(matchNsfwTags(["adulting", "nsfw-adjacent", "adventure", "cute"])).toEqual([]);
  });

  test("is case-insensitive against unexpected casing", () => {
    expect(matchNsfwTags(["Adult", "NSFW"])).toEqual(["Adult", "NSFW"]);
  });
});
