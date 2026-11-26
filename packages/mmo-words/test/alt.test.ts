import { describe, expect, test } from "vite-plus/test";

import {
  ALT_MAX,
  artAlt,
  bannerAlt,
  chartAlt,
  chartMarks,
  clampAlt,
  mapAlt,
  mapLayersAlt,
  markLabel,
  portraitAlt,
  sigilAlt,
} from "../src/alt.ts";
import { bareNumbers, type Names } from "../src/index.ts";

const LEX: Record<string, string> = {
  "creatures.archetypes:reed-rat": "Scav drone",
  "creatures.variants:plated": "Plated",
  "fights.beats:clash": "Clash",
};
const names: Names = {
  name: (sheet, id) => LEX[`${sheet}:${id}`] ?? id.charAt(0).toUpperCase() + id.slice(1),
};

/** The slots the world draws art for (render.Slots). */
const SLOTS = [
  "day",
  "fair",
  "siege",
  "raid",
  "fire",
  "corruption",
  "shortage",
  "sickness",
  "panic",
  "stage-held",
  "stage-lost",
  "finale",
  "season-close",
];

const long = "a very long name ".repeat(120);

describe("clampAlt", () => {
  test("collapses whitespace and leaves a short text alone", () => {
    expect(clampAlt("  Banner of\n  Pylon Camp ")).toBe("Banner of Pylon Camp");
  });

  test("cuts on a word with an ellipsis at the limit", () => {
    const out = clampAlt(long);
    expect(out.length).toBeLessThanOrEqual(ALT_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith(" ")).toBe(false);
  });
});

describe("bannerAlt", () => {
  test("a plain settlement", () => {
    expect(bannerAlt({ name: "Pylon Camp" })).toBe("Banner of Pylon Camp");
  });

  test("a city under raid, overrun, with what the card adds", () => {
    expect(
      bannerAlt({
        name: "Greywater",
        city: true,
        trouble: "raid",
        overrun: true,
        extra: "; a clash",
      }),
    ).toBe("Banner of Greywater, a city: fire behind its wall under a raid and overrun; a clash");
  });

  test("a ruin, a fire and another trouble by its title", () => {
    expect(bannerAlt({ name: "Cinder Gate", ruined: true, city: true })).toBe(
      "Banner of Cinder Gate, a ruin",
    );
    expect(bannerAlt({ name: "Ditchend", trouble: "fire" })).toBe(
      "Banner of Ditchend: flames in its streets",
    );
    expect(
      bannerAlt({ name: "Ditchend", trouble: "dry-well", troubleTitle: "The well runs dry" }),
    ).toBe("Banner of Ditchend: a pennant for The well runs dry");
    expect(bannerAlt({ name: "Ditchend", trouble: "dry-well" })).toBe(
      "Banner of Ditchend: a pennant for dry well",
    );
  });
});

describe("portraitAlt", () => {
  test("names the creature through Names, and the beat", () => {
    expect(portraitAlt({ creature: "reed-rat", kind: "clash" }, names)).toBe(
      "Portrait of Scav drone, met in a clash",
    );
  });

  test("a region's variant by its own name", () => {
    expect(
      portraitAlt(
        { creature: "reed-rat", creatureName: "Plated scav", variant: "plated", kind: "clash" },
        names,
      ),
    ).toBe(
      "Portrait of Plated scav, a scav drone, plated, adapted to how most win in its region, met in a clash",
    );
  });

  test("a creature name with no variant row still says what it is", () => {
    expect(portraitAlt({ creature: "reed-rat", creatureName: "Old Gnaw" }, names)).toBe(
      "Portrait of Old Gnaw, a scav drone",
    );
  });
});

describe("artAlt", () => {
  test("every slot has words of its own", () => {
    const seen = new Set<string>();
    for (const slot of SLOTS) {
      const alt = artAlt(slot);
      expect(alt).not.toBe(artAlt("no-such-slot"));
      seen.add(alt);
    }
    expect(seen.size).toBe(SLOTS.length);
  });

  test("heads the card's line, and an unknown slot still says something", () => {
    expect(artAlt("raid", "The raid on Pylon Camp was held off")).toMatch(
      /^A raid: .*\. The raid on Pylon Camp was held off$/,
    );
    expect(artAlt("no-such-slot")).toBe("A scene of the wasteland");
  });
});

describe("charts", () => {
  const days = [
    { day: 3 },
    { day: 4, cause: "trouble started near Pylon Camp" },
    { day: 5, cause: "" },
    { day: 6, cause: "arc stage-ended near Pylon Camp" },
  ];

  test("letters the days with a cause in day order, as the world does", () => {
    expect(chartMarks(days)).toEqual([
      { label: "A", day: 4, cause: "trouble started near Pylon Camp" },
      { label: "B", day: 6, cause: "arc stage-ended near Pylon Camp" },
    ]);
    expect([0, 25, 26, 701, 702].map(markLabel)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
  });

  test("tells the unit, the days, the marks and the band", () => {
    expect(
      chartAlt({ title: "Chips at close", unit: "coin per Chips", days, band: [350, 450] }),
    ).toBe(
      "Chart of Chips at close, in coin per Chips, against days, over 4 days from day 3 to day 6. Lettered marks: A on day 4 and B on day 6. A band from 350 to 450 coin per Chips is shaded",
    );
    expect(chartAlt({ title: "Chips at close", unit: "coin per Chips", days: [] })).toBe(
      "Chart of Chips at close, in coin per Chips, against days, with no days yet",
    );
    expect(chartAlt({ title: "x", unit: "coin", days: [{ day: 2 }] })).toContain(
      "over day 2 alone",
    );
    expect(
      chartAlt({
        title: "supply",
        unit: "coin per active character",
        latest: { day: 14, value: 394 },
      }),
    ).toBe(
      "Chart of supply, in coin per active character, against days. It ends on day 14 at 394 coin per active character",
    );
  });
});

describe("mapAlt and sigilAlt", () => {
  test("a map of the land", () => {
    expect(
      mapAlt({
        of: "Pylon Camp",
        radius: 6,
        shaded: ["fog over what nobody has entered", "weather", "threat"],
      }),
    ).toBe(
      "Map of Pylon Camp, 6 tiles round. Fog over what nobody has entered, weather and threat shaded",
    );
  });

  test("a dungeon floor's rooms, and where the viewer is", () => {
    expect(
      mapAlt({
        of: "the rooms of the Drowned Stair",
        parts: ["the way out", "the room you stand in", "a shut way down"],
        you: "the room you stand in",
      }),
    ).toBe(
      "Map of the rooms of the Drowned Stair: the way out, the room you stand in and a shut way down. You are at the room you stand in",
    );
    expect(mapAlt({ of: "the board", radius: 1 })).toBe("Map of the board, 1 tile round");
  });

  test("a map with tiles last seen names their dimming", () => {
    expect(
      mapAlt({
        of: "Pylon Camp",
        radius: 6,
        shaded: ["fog over what nobody has entered", "weather", "threat"],
        seen: 4,
      }),
    ).toBe(
      "Map of Pylon Camp, 6 tiles round. Fog over what nobody has entered, weather, threat and last seen, dimmed, with its age shaded",
    );
    expect(mapAlt({ of: "Pylon Camp", seen: 1 })).toBe(
      "Map of Pylon Camp. Last seen, dimmed, with its age shaded",
    );
    expect(mapAlt({ of: "Pylon Camp", shaded: ["weather"], seen: 0 })).toBe(
      "Map of Pylon Camp. Weather shaded",
    );
  });

  test("a sigil", () => {
    expect(
      sigilAlt({ name: "Hook", slot: "hand", axes: ["edge", "reach"], level: 12, picks: 2 }),
    ).toBe(
      "Sigil of Hook: its outline, its slot, hand, strongest in edge and reach, three notches for its level and two dots, one a pick",
    );
    expect(sigilAlt({ name: "Hook" })).toBe("Sigil of Hook: its outline");
    expect(sigilAlt({ name: "Hook", level: 0 })).toBe(
      "Sigil of Hook: its outline and a notch for its level",
    );
  });
});

describe("every alt", () => {
  const all = [
    bannerAlt({ name: long, trouble: "raid", extra: long }),
    portraitAlt(
      { creature: "reed-rat", creatureName: long, variant: "plated", kind: "clash" },
      names,
    ),
    artAlt("day", long),
    chartAlt({
      title: long,
      unit: "coin",
      days: Array.from({ length: 400 }, (_, i) => ({ day: i, cause: "x" })),
    }),
    mapAlt({ of: long, parts: [long, long] }),
    sigilAlt({ name: long, axes: [long] }),
  ];

  test("is at most 1,024 characters however long its inputs", () => {
    for (const a of all) expect(a.length).toBeLessThanOrEqual(ALT_MAX);
  });

  test("puts no number out bare", () => {
    const shown = [
      bannerAlt({ name: "Pylon Camp", trouble: "raid" }),
      chartAlt({
        title: "Chips at close",
        unit: "coin per Chips",
        days: [{ day: 3 }, { day: 9, cause: "c" }],
        band: [350, 450],
      }),
      mapAlt({ of: "Pylon Camp", radius: 6 }),
      mapAlt({ of: "Pylon Camp", radius: 6, seen: 12 }),
      sigilAlt({ name: "Hook", level: 12, picks: 2 }),
    ];
    for (const a of shown) expect(bareNumbers(a, new Set(["chips"]))).toEqual([]);
  });
});

describe("mapLayersAlt", () => {
  const layers = ["terrain", "roads", "threat", "busy", "self"] as const;
  const liveLayers = ["threat", "busy", "self"] as const;
  const on = new Set<string>(layers);
  const base = { of: "the wasteland", layers, liveLayers, on, self: true, seen: 0 };

  test("live off gives no shading and no ringed tile", () => {
    const alt = mapLayersAlt({ ...base, live: false, seen: 4 });
    expect(alt).toBe("Map of the wasteland: terrain and roads");
  });

  test("live on rings the viewer and leads shading with the rim", () => {
    const alt = mapLayersAlt({ ...base, live: true });
    expect(alt).toContain("You are at the ringed tile");
    expect(alt).toContain(". What you have in sight, rimmed, threat and how busy shaded");
  });

  test("a turned-off base layer is left out", () => {
    const alt = mapLayersAlt({ ...base, on: new Set(["terrain"]), live: false });
    expect(alt).toBe("Map of the wasteland: terrain");
  });

  test("last-seen tiles are named only when live", () => {
    expect(mapLayersAlt({ ...base, live: true, seen: 3 })).toContain("last seen, dimmed");
    expect(mapLayersAlt({ ...base, live: false, seen: 3 })).not.toContain("last seen");
  });
});
