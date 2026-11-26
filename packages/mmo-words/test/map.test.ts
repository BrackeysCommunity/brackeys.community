import { describe, expect, test } from "vite-plus/test";

import {
  bareNumbers,
  busyWords,
  FOG_WORDS,
  MAP_LAYER_NAMES,
  seenAgo,
  TICKS_PER_DAY,
} from "../src/index.ts";

describe("the live map's words", () => {
  test("each fog state has its words", () => {
    expect(FOG_WORDS).toEqual({
      unknown: "nobody has been here",
      sight: "in sight",
      seen: "last seen",
      discovered: "found, not seen by you",
    });
  });

  test("seenAgo counts whole world days", () => {
    const left = 500;
    expect(seenAgo(left, left)).toBe("seen less than a world day ago");
    expect(seenAgo(left + TICKS_PER_DAY - 1, left)).toBe("seen less than a world day ago");
    expect(seenAgo(left + TICKS_PER_DAY, left)).toBe("seen 1 world day ago");
    expect(seenAgo(left + 2 * TICKS_PER_DAY - 1, left)).toBe("seen 1 world day ago");
    expect(seenAgo(left + 2 * TICKS_PER_DAY, left)).toBe("seen 2 world days ago");
    expect(seenAgo(left + 1200 * TICKS_PER_DAY, left)).toBe("seen 1,200 world days ago");
  });

  test("a record newer than the tick reads as less than a day", () => {
    expect(seenAgo(10, 20)).toBe("seen less than a world day ago");
  });

  test("busy bands, quiet when empty", () => {
    expect(busyWords("")).toBe("quiet");
    expect(busyWords("light")).toBe("a few through lately");
    expect(busyWords("busy")).toBe("busy");
    expect(busyWords("crowded")).toBe("crowded");
    expect(busyWords("packed-in")).toBe("packed in");
  });

  test("every layer the map toggles has a name", () => {
    for (const id of [
      "terrain",
      "regions",
      "roads",
      "places",
      "threat",
      "corruption",
      "weather",
      "troubles",
      "busy",
      "self",
    ])
      expect(MAP_LAYER_NAMES[id]).toBeTruthy();
    expect(MAP_LAYER_NAMES.places).toBe("Settlements and cities");
    expect(MAP_LAYER_NAMES.busy).toBe("How busy");
  });

  test("no number goes out bare", () => {
    for (const days of [0, 1, 2, 30, 1200])
      expect(bareNumbers(seenAgo(days * TICKS_PER_DAY, 0))).toEqual([]);
  });
});
