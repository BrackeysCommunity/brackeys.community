import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import {
  arcWords,
  bareNumbers,
  chronicleLine,
  countWords,
  emergenceWords,
  list,
  PROMOTION_TYPES,
  promotionCount,
  promotionCounts,
  seasonAdded,
  seasonTurnLine,
  sideName,
  sideWords,
  stageWords,
  type Datum,
  type Names,
  type StoryFact,
} from "../src/index.ts";

const readable = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, " ");

/** Names as the bot's Lexicon gives them: a row it does not know reads as its id. */
const NAMES: Names = {
  name: (sheet, id) =>
    (
      ({
        "creatures.archetypes:reed-rat": "Scav drone",
        "items.materials:hide-scraps": "Hide scraps",
        "items.materials:found.plated.hide-scraps": "Plated hide",
        "map.site-kinds:ruin": "Ruin",
        "puzzles.families:rewire": "Rewire",
      }) as Record<string, string>
    )[`${sheet}:${id}`] ?? readable(id),
  ref: (r) =>
    (
      ({
        "region:r-2": "Dunmarch",
        "settlement:0": "Ashford",
        "settlement:4": "Kell's Rest",
        "character:c-1": "Wren Ashdown",
      }) as Record<string, string>
    )[`${r.kind}:${r.id}`],
};

const d = (o: Record<string, string | number>): Datum[] =>
  Object.entries(o).map(([k, v]) => (typeof v === "number" ? { k, n: v } : { k, s: v }));

const promotion = (type: string, o: Record<string, string | number>): StoryFact => ({
  kind: "promotion",
  region: "r-2",
  subjects: [
    { kind: "promotion", id: `${type}:1` },
    { kind: "character", id: "c-1" },
  ],
  data: d({ type, id: `${type}:1`, ...o }),
});

const arcs = JSON.parse(
  readFileSync(
    new URL("../../../services/mmo-world/sheets/story/arcs.json", import.meta.url),
    "utf8",
  ),
) as { rows: { id: string; stages: { id: string; sides: { id: string }[] }[] }[] };

/** The templates play itself casts (GDD 12.9, 17.6). */
const EMERGENT = ["the-road-war", "the-lost-caravan", "the-rival-claims", "the-legend-wakes"];

describe("promotion lines", () => {
  test("each type reads, naming the thing and never its first", () => {
    const lines = [
      promotion("road", { name: "the Ashford road" }),
      promotion("variant", {
        name: "Plated scav drone",
        of: "reed-rat",
        resists: "keen",
        material: "found.plated.hide-scraps",
      }),
      promotion("material", {
        name: "Plated hide",
        of: "found.plated.hide-scraps",
        base: "hide-scraps",
      }),
      promotion("route", { name: "Ashford–Kell's Rest", a: 0, b: 4 }),
      promotion("custom", { name: "the Ashford haul" }),
    ].map((f) => chronicleLine(f, NAMES));
    expect(lines).toEqual([
      "The Ashford road formed in Dunmarch: walked so often that it became a road.",
      "Plated scav drone appeared in Dunmarch: the region's scav drone adapted against how it was beaten, and now resists keen. It drops plated hide.",
      "A new material came into the world in Dunmarch: Plated hide, a harder kind of hide scraps, dropped by the region's adapted creatures.",
      "Ashford–Kell's Rest became a trade route: so much was hauled between Ashford and Kell's Rest that caravans now run it.",
      "The Ashford haul became a custom: posted season after season, it is now posted by the world each season.",
    ]);
    for (const line of lines) expect(line).not.toContain("Wren");
  });

  test("a found material the names do not know yet is a new material", () => {
    expect(
      chronicleLine(
        promotion("variant", { name: "Plated scav drone", material: "found.plated.thick-hide" }),
        NAMES,
      ),
    ).toContain("It drops a new material.");
  });

  test("a first loot names the material, not who took it", () => {
    const f: StoryFact = {
      kind: "material.looted-first",
      region: "r-2",
      subjects: [{ kind: "character", id: "c-1" }],
      data: d({ material: "found.plated.hide-scraps", name: "Plated hide" }),
    };
    expect(chronicleLine(f, NAMES)).toBe("Plated hide was taken for the first time in Dunmarch.");
  });

  test("roads cut and tolled, and a caravan robbed, say for how long and how much", () => {
    const f = (kind: string, o: Record<string, string | number>): StoryFact => ({
      kind,
      region: "r-2",
      subjects: [{ kind: "promotion", id: "road:1" }],
      data: d(o),
    });
    expect(chronicleLine(f("road.cut", { name: "the Ashford road", days: 3 }), NAMES)).toBe(
      "The Ashford road in Dunmarch was cut: no quicker than open ground for 3 days.",
    );
    expect(
      chronicleLine(f("road.tolled", { name: "the Ashford road", days: 14, coin: 2 }), NAMES),
    ).toBe("The Ashford road in Dunmarch is tolled: 2 coin a crossing for 14 days.");
    expect(
      chronicleLine(f("caravan.robbed", { name: "Ashford–Kell's Rest", units: 15 }), NAMES),
    ).toBe(
      "Raiders robbed a caravan on the Ashford–Kell's Rest route in Dunmarch: 15 goods taken, left where it was struck.",
    );
  });
});

describe("the emergent templates", () => {
  test("every template, stage and side play casts has its words", () => {
    const rows = arcs.rows.filter((r) => EMERGENT.includes(r.id));
    expect(rows.map((r) => r.id).sort()).toEqual([...EMERGENT].sort());
    for (const r of rows) {
      const w = arcWords(r.id);
      expect(w?.about, r.id).toBeTruthy();
      expect(w?.origin, r.id).toBeTruthy();
      expect(w?.lapse, r.id).toBeTruthy();
      for (const st of r.stages) {
        expect(stageWords(st.id), st.id).not.toBe("");
        for (const s of st.sides) {
          expect(sideWords(s.id)?.asks, s.id).toBeTruthy();
          expect(sideWords(s.id)?.won, s.id).toBeTruthy();
          expect(sideName(s.id, NAMES), s.id).not.toMatch(/ [ab]$/);
        }
      }
    }
  });

  test("the rival claims say they came from two goals", () => {
    expect(arcWords("the-rival-claims")?.origin).toContain("two goals");
  });

  test("a claim's side is named by its seat, and the pack's own name wins", () => {
    expect(sideName("back-a", NAMES)).toBe("Back the first claim");
    expect(sideName("back-b", NAMES, "Kell's Rest")).toBe("Back Kell's Rest's claim");
    expect(sideName("patrol-it", NAMES)).toBe("Patrol it");
    expect(sideName("back-a", { name: () => "Stake Ashford's claim" }, "Ashford")).toBe(
      "Stake Ashford's claim",
    );
    expect(sideName("garrison")).toBe("Garrison");
  });

  test("no number in their words goes out bare", () => {
    const w = emergenceWords();
    const texts = [
      ...w.arcs.flatMap((id) => Object.values(arcWords(id) ?? {})),
      ...w.stages.map(stageWords),
      ...w.sides.flatMap((id) => Object.values(sideWords(id) ?? {})),
    ];
    for (const t of texts) expect(bareNumbers(t), t).toEqual([]);
  });
});

describe("the season's turn", () => {
  const added: StoryFact = {
    kind: "season.added",
    subjects: [],
    data: d({ season: 1, styles: 1, variants: 2, materials: 1, classes: 1, first: "Plated hide" }),
  };

  test("it names what was kept, faded and added", () => {
    expect(seasonTurnLine({ season: 1, kept: { road: 2, camp: 1, style: 1 }, added })).toBe(
      "Season 1 closed. Kept: everything play made part of the world, this season's 2 roads, 1 camp and 1 style among it. Faded: every trace that never reached its line; crossings, clearings and wins start again from nothing. Added: 1 style, 2 variants, 1 material and 1 class, Plated hide among them.",
    );
    expect(seasonAdded()).toBe("Added: nothing new to use this time.");
    expect(chronicleLine(added)).toBe(
      "Season 1 added to the world: 1 style, 2 variants, 1 material and 1 class, Plated hide among them.",
    );
  });

  test("no number goes out bare", () => {
    for (const n of [0, 1, 7, 1234]) {
      const kept = Object.fromEntries(
        [...PROMOTION_TYPES, "material", "class", "masters"].map((t) => [t, n]),
      );
      const a = { ...added, data: d({ season: n, styles: n, variants: n, materials: n }) };
      expect(bareNumbers(seasonTurnLine({ season: n, kept, added: a }))).toEqual([]);
    }
  });
});

describe("promotion counts", () => {
  test("in a fixed order, the zeros left out", () => {
    expect(promotionCounts({ style: 1, road: 3, custom: 0, legend: 2 })).toBe(
      "3 roads, 1 style and 2 legends",
    );
    expect(promotionCount("masters", 2)).toBe("2 benches of masters");
    expect(promotionCount("new-type", 1)).toBe("1 promotion");
    expect(promotionCounts({})).toBe("");
  });

  test("the emergence units are units", () => {
    expect(
      bareNumbers(
        "60 crossings, 40 clearings, 2 roads, 1 route, 3 caravans, 1 legend, 1 custom, 10 wins, 25 attempts, 4 promotions",
      ),
    ).toEqual([]);
  });
});

describe("list", () => {
  test("joins with commas and a final and", () => {
    expect(list([])).toBe("");
    expect(list(["a"])).toBe("a");
    expect(list(["a", "b"])).toBe("a and b");
    expect(list(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("countWords", () => {
  test("small counts in words, larger in digits, one with its article", () => {
    expect(countWords(0, "style")).toBe("no styles");
    expect(countWords(1, "style")).toBe("a style");
    expect(countWords(1, "item")).toBe("an item");
    expect(countWords(2, "style")).toBe("two styles");
    expect(countWords(13, "style")).toBe("13 styles");
    expect(countWords(3, "ally", "allies")).toBe("three allies");
  });
});
