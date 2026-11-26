import { describe, expect, test } from "vite-plus/test";

import type { MapCell, MapTileView } from "../../mmo-api/src/index.ts";
import {
  bareNumbers,
  busyWords,
  FOG_WORDS,
  MAP_LAYER_NAMES,
  seenAgo,
  TICKS_PER_DAY,
  tileWords,
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
    ] as const)
      expect(MAP_LAYER_NAMES[id]).toBeTruthy();
    expect(MAP_LAYER_NAMES.places).toBe("Settlements and cities");
    expect(MAP_LAYER_NAMES.busy).toBe("How busy");
  });

  test("no number goes out bare", () => {
    for (const days of [0, 1, 2, 30, 1200])
      expect(bareNumbers(seenAgo(days * TICKS_PER_DAY, 0))).toEqual([]);
  });
});

describe("a tile in words", () => {
  const cell: MapCell = {
    q: 1,
    r: 2,
    terrain: "ash-flats",
    region: "region-1",
    road: 3,
    place: "ruin",
    placeRef: "ruin-1",
  };
  const at = {
    tick: 10 * TICKS_PER_DAY,
    names: { "region-1": "the Cinder Reach", "ruin-1": "Old Pylon" },
  };

  test("ground nobody has found says only that", () => {
    expect(tileWords(undefined, at)).toEqual({
      title: "Unknown ground",
      fog: "unknown",
      fogLine: "Nobody has been here.",
      liveHeading: "In sight now",
      base: [],
      live: [],
    });
  });

  test("a tile in sight has its base and its live values now", () => {
    const t: MapTileView = {
      cell,
      fog: "sight",
      live: { q: 1, r: 2, fog: "sight", threat: 5, fire: true, busy: "light" },
    };
    const w = tileWords(t, { ...at, self: { q: 1, r: 2 } });
    expect(w.title).toBe("Old Pylon");
    expect(w.fogLine).toBe("In sight.");
    expect(w.age).toBeUndefined();
    expect(w.base).toEqual([
      "Ash flats",
      "In the Cinder Reach",
      "A ruin",
      "A road at level 3",
      "You are here.",
    ]);
    expect(w.live).toEqual([
      "5 threat in its region",
      "A fire is burning",
      "How busy: a few through lately",
    ]);
  });

  test("a last-seen tile carries its age", () => {
    const t: MapTileView = {
      cell,
      fog: "seen",
      live: { q: 1, r: 2, fog: "seen", left: 7 * TICKS_PER_DAY },
    };
    const w = tileWords(t, at);
    expect(w.fogLine).toBe("Last seen.");
    expect(w.age).toBe("Seen 3 world days ago.");
    expect(w.ageLine).toMatch(/As it was then:$/);
    expect(w.liveHeading).toBe("Last seen");
    expect(w.live).toEqual(["How busy: quiet"]);
  });

  test("an ecotone edges into its second ground", () => {
    const t: MapTileView = {
      cell: { ...cell, secondary: "rust-dunes", blend: 2 },
      fog: "discovered",
    };
    expect(tileWords(t, at).base).toContain("Edging into rust dunes");
    const none: MapTileView = {
      cell: { ...cell, secondary: "rust-dunes", blend: 0 },
      fog: "discovered",
    };
    expect(tileWords(none, at).base.join(" ")).not.toMatch(/Edging/);
  });

  test("a camp keeps the name the world sent", () => {
    const t: MapTileView = {
      cell,
      fog: "sight",
      live: { q: 1, r: 2, fog: "sight", camp: "Rust-Eaters" },
    };
    expect(tileWords(t, at).live).toContain("Camp: Rust-Eaters");
  });

  test("the terrain namer names the ground", () => {
    const t: MapTileView = { cell: { q: 0, r: 0, terrain: "ash-flats" }, fog: "discovered" };
    expect(tileWords(t, at).title).toBe("Ash flats");
    expect(tileWords(t, at, (id) => `The ${id}`).title).toBe("The ash-flats");
    const w = tileWords(t, at);
    expect(w.live).toEqual([]);
    for (const l of [...w.base, w.fogLine]) expect(bareNumbers(l)).toEqual([]);
  });
});
