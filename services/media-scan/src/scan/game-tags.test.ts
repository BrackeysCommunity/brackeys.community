import { describe, expect, test } from "bun:test";

import { matchNsfwTags, parseGameData } from "./game-tags.ts";

describe("parseGameData", () => {
  test("reads the tags array from a game payload", () => {
    expect(
      parseGameData({ id: 3361070, title: "x", tags: ["adult", "roguelike", "nsfw"] })?.tags,
    ).toEqual(["adult", "roguelike", "nsfw"]);
  });

  test("an untagged game is a verdict, not a failure", () => {
    expect(parseGameData({ id: 1, title: "x" })?.tags).toEqual([]);
  });

  test("drops non-string entries instead of failing the payload", () => {
    expect(parseGameData({ tags: ["adult", 7, null, { url: "/soundtracks" }] })?.tags).toEqual([
      "adult",
    ]);
  });

  test("carries the current cover URL when the payload has one", () => {
    expect(parseGameData({ tags: [], cover_image: "https://img.itch.zone/x.png" })).toEqual({
      tags: [],
      coverImage: "https://img.itch.zone/x.png",
    });
    expect(parseGameData({ tags: [] })?.coverImage).toBeNull();
    expect(parseGameData({ tags: [], cover_image: 7 })?.coverImage).toBeNull();
  });

  test("itch error bodies and non-objects yield no verdict", () => {
    expect(parseGameData({ errors: ["invalid game"] })).toBeNull();
    expect(parseGameData("<!doctype html>")).toBeNull();
    expect(parseGameData(null)).toBeNull();
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
