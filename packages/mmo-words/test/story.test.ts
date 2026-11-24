import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import {
  bareNumbers,
  castNames,
  chronicleKinds,
  chronicleLine,
  clueLine,
  heldLine,
  patternKind,
  patternLine,
  refKey,
  seasonLine,
  sideLine,
  troubleBanner,
  wantUnit,
  type Datum,
  type Names,
  type Ref,
  type StoryFact,
} from "../src/index.ts";

/** The kinds the director, the seasons, the cities and the patterns write. */
const STORY_KINDS = [
  "arc.cast",
  "arc.stage-began",
  "arc.stage-ended",
  "arc.ended",
  "side.backed",
  "character.marked",
  "trouble.started",
  "trouble.held",
  "trouble.lost",
  "occasion.began",
  "occasion.ended",
  "structure.damaged",
  "settlement.ruined",
  "city.project",
  "city.raised",
  "city.fell-back",
  "faction.city",
  "faction.split",
  "thread.cast",
  "thread.ended",
  "season.began",
  "season.band",
  "season.finale",
  "season.closed",
  "season.epoch",
  "core.opened",
  "core.sealed",
  "pattern.clue",
  "pattern.set",
  "pattern.haywire",
  "pattern.lapsed",
  "pattern.solved",
  "pattern.placed",
  "pattern.cache",
  "npc.called",
  "npc.woke",
  "region.gauge-moved",
  "notable.loyalty-moved",
  "faction.peace",
  "faction.grudge",
  "node.seam",
  "promotion",
  "promotion.renamed",
  "road.grew",
  "road.cut",
  "road.tolled",
  "caravan.departed",
  "caravan.arrived",
  "caravan.robbed",
  "caravan.lost",
  "legend.laid",
  "custom.held",
  "custom.skipped",
  "material.looted-first",
  "season.added",
  "emergence.started",
  "theft.made",
  "watch.caught",
  "character.betrayed",
];

const weights = JSON.parse(
  readFileSync(
    new URL("../../../services/mmo-world/sheets/story/fact-weights.json", import.meta.url),
    "utf8",
  ),
) as { rows: { kind: string; weight: number }[] };
const HEAVY = weights.rows.filter((r) => r.weight >= 60).map((r) => r.kind);

const CHAR = "c-7f3a9e";
const CHAR_NAME = "Wren Ashdown";

/** Names as the bot's Lexicon and the arcs' cast would give them. */
const NAMES: Names = {
  name: (_sheet, id) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " "),
  ref: (r) =>
    r.kind === "character"
      ? CHAR_NAME
      : (
          {
            faction: { "f-0": "Raider Compact", "f-1": "Militia" },
            region: { "r-2": "Dunmarch", "r-3": "Saltreach" },
            settlement: { "0": "Ashford", "4": "Kell's Rest" },
            notable: { "n-5": "Ora Vane" },
            npc: { "npc-9": "Old Tamsin" },
            guild: { "g-1": "the Lantern Guild" },
            tile: { "3,4": "the Core" },
          } as Record<string, Record<string, string>>
        )[r.kind]?.[r.id],
};
const GOODS = new Set(["scrap", "provisions"]);

const SUBJECTS: Ref[] = [
  { kind: "arc", id: "a-12" },
  { kind: "character", id: CHAR },
  { kind: "faction", id: "f-0" },
  { kind: "faction", id: "f-1" },
  { kind: "notable", id: "n-5" },
  { kind: "settlement", id: "4" },
  { kind: "region", id: "r-3" },
  { kind: "npc", id: "npc-9" },
  { kind: "guild", id: "g-1" },
  { kind: "tile", id: "3,4" },
  { kind: "pattern", id: "triangle@3,4" },
];

/** Every datum a line reads, at one size; strings name a character where a careless line might print one. */
function data(n: number, s: Record<string, string>): Datum[] {
  const nums = [
    "stage",
    "due",
    "backers",
    "units",
    "lapsed",
    "stages",
    "settlement",
    "days",
    "points",
    "condition",
    "closed",
    "treasury",
    "coin",
    "season",
    "start",
    "from",
    "to",
    "sheets",
    "towers",
    "point",
    "other",
    "n",
    "value",
    "reach",
    "threat",
    "attempts",
    "wrong",
    "depth",
    "goods",
    "kept",
    "folded",
    "by",
    "loyalty",
    "grudge",
    "stock",
    "holdings",
    "tier",
    "hunters",
    "health",
    "defence",
    "scarcity",
    "unrest",
    "corruption",
    "prosperity",
    "mark:garrison",
    "q",
    "r",
    "a",
    "b",
    "short",
    "styles",
    "variants",
    "materials",
    "classes",
    "worth",
    "witnessed",
  ];
  return [
    ...nums.map((k) => ({ k, n: k === "settlement" ? 0 : n })),
    ...Object.entries(s).map(([k, v]) => ({ k, s: v })),
    { k: "who", s: CHAR },
  ];
}

const STRINGS: Record<string, string>[] = [
  {
    arc: "a-12",
    template: "the-siege",
    scope: "world",
    stageId: "the-approach",
    by: CHAR,
    side: "garrison",
    outcome: "garrison",
    occasion: "caravan",
    structure: "forge",
    guild: "g-1",
    project: "city-g-1",
    region: "r-2",
    band: "rising",
    board: "triangle@3,4",
    rule: "triangle",
    says: "offset",
    cache: "vault-cache",
    gauge: "threat",
    material: "scrap",
    role: "leader",
    name: "Hollowmere",
    archetype: "reed-rat",
    process: "forge",
    season: "wet",
    kind: "storm",
    line: "threat-raid",
    type: "road",
    id: "road:1",
    via: "pattern",
    first: "Plated hide",
    was: "Edge-and-ember",
  },
  {
    template: "raid",
    side: "lapsed",
    outcome: "lapsed",
    occasion: "migration",
    says: "near",
    from: "triangle@3,4",
    band: "finale",
    board: "placed-0",
    rule: "second-triangle",
    gauge: "scarcity",
  },
  { template: "fire", occasion: "seam", says: "after", side: "hold-it-off" },
  { template: "panic", occasion: "fair", says: "facing" },
  { template: "the-debt", says: "live" },
  { template: "the-oath", says: "missing" },
  { type: "road", name: "the Ashford road", id: "road:2", route: "route:1" },
  { type: "camp", of: "ruin", name: "the Reedbank camp" },
  { type: "haunt", of: "den" },
  { type: "route", name: "Ashford–Kell's Rest", id: "route:1" },
  { type: "style", of: "edge-and-ember", name: "Edge-and-ember" },
  {
    type: "variant",
    of: "reed-rat",
    name: "Plated scav drone",
    row: "plated",
    resists: "keen",
    material: "found.plated.hide-scraps",
    style: "edge-and-ember",
  },
  {
    type: "material",
    of: "found.plated.hide-scraps",
    row: "plated",
    variant: "variant:3",
    base: "hide-scraps",
    material: "found.plated.hide-scraps",
  },
  { type: "legend", of: "creature:reed-rat", name: "Scav drone the Unbroken" },
  { type: "legend", of: "item:i-41", "of-name": "Old Rust", name: "Old Rust the Patient" },
  { type: "custom", verb: "deliver", goal: "q-9", name: "the Ashford deliver" },
  { type: "class", of: "router" },
  { type: "masters", of: "rewire", name: "Ashford masters" },
  { type: "something-new" },
  { template: "thief-in-walls", kind: "lift", outcome: "won", faction: "faction:1", act: "theft" },
  { kind: "lift", outcome: "lost", faction: "syndicate", act: "informed", item: "i-41" },
  { kind: "burgle", outcome: "won", faction: "faction:0", material: "scrap", item: "i-41" },
  { kind: "burgle", outcome: "empty", faction: "faction:9" },
  { kind: "waylay", outcome: "won", side: "prey-it", faction: "faction:1" },
  { kind: "waylay", outcome: "lost" },
  { kind: "flee", outcome: "won", act: "vow-broken" },
];

function samples(kind: string): StoryFact[] {
  const out: StoryFact[] = [];
  for (const n of [0, 1, 7, 1234])
    for (const s of STRINGS)
      for (const region of ["r-2", "", "l-1.2"])
        out.push({ kind, region, subjects: SUBJECTS, data: data(n, s) });
  return out;
}

const KINDS = [...new Set([...STORY_KINDS, ...HEAVY, ...chronicleKinds()])];

describe("chronicleLine", () => {
  test("every story kind has its own line", () => {
    expect(STORY_KINDS.filter((k) => !chronicleKinds().includes(k))).toEqual([]);
  });

  test("every kind the chronicle posts has its own line", () => {
    expect(HEAVY.length).toBeGreaterThan(30);
    expect(HEAVY.filter((k) => !chronicleKinds().includes(k))).toEqual([]);
  });

  test("the story kinds are all in the weights sheet", () => {
    const known = new Set(weights.rows.map((r) => r.kind));
    expect(STORY_KINDS.filter((k) => !known.has(k))).toEqual([]);
  });

  test("no line names a character or holds a character id", () => {
    for (const kind of KINDS)
      for (const f of samples(kind))
        for (const line of [chronicleLine(f, NAMES), chronicleLine(f)]) {
          expect(line, kind).not.toContain(CHAR);
          expect(line, kind).not.toContain(CHAR_NAME);
        }
  });

  test("no number in a line goes out bare", () => {
    for (const kind of KINDS)
      for (const f of samples(kind))
        for (const line of [chronicleLine(f, NAMES), chronicleLine(f)])
          expect(bareNumbers(line, GOODS), `${kind}: ${line}`).toEqual([]);
  });

  test("lines name the world's things", () => {
    const f = (
      kind: string,
      d: Datum[],
      subjects: Ref[] = SUBJECTS,
      region = "r-2",
    ): StoryFact => ({
      kind,
      region,
      subjects,
      data: d,
    });
    expect(
      chronicleLine(
        f("arc.cast", [
          { k: "template", s: "the-siege" },
          { k: "stage", n: 0 },
          { k: "stageId", s: "the-approach" },
        ]),
        NAMES,
      ),
    ).toBe(
      "The siege began in Dunmarch, with Raider Compact, Militia and Ora Vane. Stage 1: The approach.",
    );
    expect(
      chronicleLine(
        f("trouble.started", [
          { k: "template", s: "raid" },
          { k: "settlement", n: 4 },
          { k: "mark:hold-it-off", n: 21 },
        ]),
        NAMES,
      ),
    ).toBe("Raid at Kell's Rest: 21 defence to hold it off by the day's end.");
    expect(
      chronicleLine(
        f("trouble.lost", [
          { k: "template", s: "raid" },
          { k: "settlement", n: 0 },
        ]),
        NAMES,
      ),
    ).toBe("Ashford lost to the raid.");
    expect(
      chronicleLine(
        f(
          "settlement.founded",
          [{ k: "name", s: "Hollowmere" }],
          [
            { kind: "character", id: CHAR },
            { kind: "guild", id: "g-1" },
          ],
        ),
        NAMES,
      ),
    ).toBe("The Lantern Guild founded Hollowmere in Dunmarch.");
    expect(
      chronicleLine(
        f(
          "season.closed",
          [
            { k: "season", n: 0 },
            { k: "days", n: 14 },
          ],
          [],
          "",
        ),
      ),
    ).toBe("Season 0 closed after 14 days.");
    expect(
      chronicleLine(
        f("core.opened", [{ k: "towers", n: 8 }], [{ kind: "tile", id: "3,4" }]),
        NAMES,
      ),
    ).toBe("The core opened: all 8 towers of the ring fell this season.");
  });

  test("a line falls back to plain words without names", () => {
    expect(
      chronicleLine({
        kind: "faction.peace",
        region: "r-2",
        subjects: [
          { kind: "faction", id: "f-0" },
          { kind: "faction", id: "f-1" },
        ],
        data: [],
      }),
    ).toBe("A faction and a faction made peace.");
    expect(chronicleLine({ kind: "some.new-kind", subjects: [], data: [] })).toBe("Some new kind.");
  });
});

describe("clueLine", () => {
  const clue = (says: string, n: number): StoryFact => ({
    kind: "pattern.clue",
    subjects: [],
    data: [
      { k: "says", s: says },
      { k: "point", n: 0 },
      { k: "other", n: 2 },
      { k: "n", n },
    ],
  });
  test("each kind of clue reads", () => {
    expect(clueLine(clue("offset", 2))).toBe("point #3 is set 2 values past point #1");
    expect(clueLine(clue("offset", 0))).toBe("point #3 holds the same value as point #1");
    expect(clueLine(clue("facing", 1))).toBe("point #1 faces north-east (#1)");
    expect(clueLine(clue("facing", 9))).toBe("point #1 faces its own way");
    expect(clueLine(clue("after", 0))).toBe("point #1 comes before point #3");
    expect(clueLine(clue("near", 1))).toBe("the hidden point is within 1 point of point #1");
    for (const says of ["after", "offset", "facing", "live", "missing", "near", "other"])
      for (const n of [0, 1, 5]) expect(bareNumbers(clueLine(clue(says, n)))).toEqual([]);
  });
  test("a namer names the points, and the rest of the line keeps its words", () => {
    const letter = (i: number) => `point ${"ABC"[i]}`;
    expect(clueLine(clue("after", 0), letter)).toBe("point A comes before point C");
    expect(clueLine(clue("missing", 0), letter)).toBe("the gap lies from point A to point C");
    expect(clueLine(clue("offset", 1), letter)).toBe("point C is set 1 value past point A");
  });
});

describe("pattern kinds", () => {
  test("a kind is named, and what a point holds reads by it", () => {
    expect(patternKind("state")).toBe("settings");
    expect(patternKind("constellation")).toBe("the hidden one");
    expect(heldLine("state", 2)).toBe("holds setting #2");
    expect(heldLine("alignment", 4)).toBe("faces south-west (#4)");
    expect(heldLine("alignment", 9)).toBe("faces #9");
    expect(heldLine("constellation", 0)).toBe("is found");
    expect(heldLine("constellation", 1)).toBe("is activated");
  });
});

describe("wantUnit", () => {
  test("a side's mark counts in what it wants, beats as points", () => {
    expect(wantUnit("beats")).toBe("points");
    expect(wantUnit("reach")).toBe("characters");
    expect(wantUnit("sold")).toBe("coin");
    expect(wantUnit("whatever")).toBe("goods");
  });
});

describe("sideLine", () => {
  const side = {
    title: "Garrison",
    wants: "goods",
    tag: "provisions",
    mark: 250,
    filled: 120,
    backers: 3,
    pay: 300,
    at: "Ashford",
    sponsor: "Militia",
    opponent: "Raider Compact",
    mine: false,
  };
  test("a side reads its mark, backers and pay", () => {
    expect(sideLine(side)).toBe(
      "Garrison · provisions to Ashford · 120 of 250 provisions · 3 backers · pays 300 coin · for Militia, against Raider Compact",
    );
    expect(
      sideLine({
        ...side,
        wants: "beats",
        tag: "",
        filled: 400,
        backers: 1,
        mine: true,
        opponent: "",
      }),
    ).toBe(
      "Garrison · beats won in Ashford · 250 of 250 points · 1 backer · pays 300 coin · for Militia · you back it",
    );
  });
  test("no number goes out bare", () => {
    for (const wants of ["goods", "beats", "reach", "defence", "sold", "new"])
      for (const tag of ["", "provisions", "scrap", "stone"])
        for (const n of [0, 1, 25, 12000])
          expect(
            bareNumbers(
              sideLine({ ...side, wants, tag, mark: n, filled: n, backers: n, pay: n }, NAMES),
              GOODS,
            ),
          ).toEqual([]);
  });
});

describe("troubleBanner", () => {
  const raid = { kind: "raid", title: "Raid", mark: 21, defence: 9, ends: 150 };
  test("a banner says how far its mark is, when it ends and why", () => {
    expect(troubleBanner(raid, { place: "Ashford", now: 144 })).toBe(
      "Raid at Ashford: 9 of 21 defence to hold it off · ends in 6 ticks (60 min)",
    );
    const why: StoryFact = {
      kind: "region.raids",
      region: "r-2",
      subjects: [],
      data: [{ k: "threat", n: 820 }],
    };
    expect(troubleBanner({ ...raid, why }, { names: NAMES })).toBe(
      "Raid: 9 of 21 defence to hold it off · why: Dunmarch reached 820 threat: raiders ride out from it.",
    );
  });
  test("no number goes out bare", () => {
    for (const kind of ["raid", "fire", "corruption", "shortage", "sickness", "panic", "new"])
      for (const n of [0, 1, 70, 5000])
        expect(
          bareNumbers(
            troubleBanner(
              { kind, title: "", mark: n, defence: n, ends: n },
              { place: "Ashford", now: 0 },
            ),
          ),
        ).toEqual([]);
  });
});

describe("seasonLine", () => {
  test("the season, its day and its band", () => {
    expect(seasonLine({ n: 1, day: 12, days: 42, band: "rising" })).toBe(
      "Season 1 · day 12 of 42 days · its rising · 30 days to the close",
    );
    expect(seasonLine({ n: 0, day: 14, days: 14, band: "finale" })).toBe(
      "Season 0 · day 14 of 14 days · its finale · it closes today",
    );
    for (const band of ["opening", "rising", "last", "finale", "new"])
      for (const n of [0, 1, 13, 41])
        expect(bareNumbers(seasonLine({ n, day: n, days: 42, band }))).toEqual([]);
  });
});

describe("patternLine", () => {
  const p = {
    board: "triangle@3,4",
    kind: "state",
    place: "pylon",
    family: "circuit",
    point: 1,
    points: 3,
    values: 4,
    held: 2,
    solved: false,
    clues: [{ kind: "pattern.clue", subjects: [], data: [] }],
  };
  test("the point stood on, with what the viewer holds", () => {
    expect(patternLine(p, NAMES)).toBe(
      "Triangle · point #2 of 3 points · a pylon, set by a Circuit · held at value 3 of 4 values · it wants every point set to its value · 1 clue found",
    );
    expect(
      patternLine({ ...p, held: undefined, clues: [], family: undefined, place: "beacon" }),
    ).toBe(
      "Triangle · point #2 of 3 points · a beacon, set by a delivery · not set by you · it wants every point set to its value · no clue found yet",
    );
    expect(patternLine({ ...p, solved: true, board: "placed-0" })).toBe(
      "Pattern · point #2 of 3 points · a pylon, set by a Circuit · solved · 1 clue found",
    );
  });
  test("no number goes out bare", () => {
    for (const kind of ["state", "order", "alignment", "connection", "completion", "constellation"])
      for (const n of [0, 1, 6])
        expect(
          bareNumbers(patternLine({ ...p, kind, point: n, points: n, values: n, held: n }, NAMES)),
        ).toEqual([]);
  });
});

describe("castNames", () => {
  test("the cast's names, never a character's", () => {
    const m = castNames([
      {
        cast: [
          { kind: "faction", id: "f-0", name: "Raider Compact" },
          { kind: "character", id: CHAR, name: CHAR_NAME },
          { kind: "region", id: "r-2" },
        ],
      },
    ]);
    expect([...m]).toEqual([[refKey({ kind: "faction", id: "f-0" }), "Raider Compact"]]);
  });
});

describe("bareNumbers", () => {
  test("the story's units and unit-first words", () => {
    expect(
      bareNumbers(
        "Stage 2 of 3 stages in Season 1 of 4 seasons: 2 sides, 1 backer, 5 backers, 8 towers, 1 guardian, 3 guardians, 3 pylons, 1 point, 40 points, value 2 of 4 values, 2 clues.",
      ),
    ).toEqual([]);
    expect(bareNumbers("Season one: stage 2, 7 of them")).toEqual(["7"]);
    expect(bareNumbers("Crooked, −15 alignment; 3 alignment today")).toEqual([]);
  });
});

describe("crime lines", () => {
  const theft = (o: Record<string, string | number>, subjects: Ref[] = []): StoryFact => ({
    kind: "theft.made",
    region: "r-2",
    subjects: [{ kind: "character", id: CHAR }, ...subjects],
    data: Object.entries(o).map(([k, v]) => (typeof v === "number" ? { k, n: v } : { k, s: v })),
  });
  const npc: Ref = { kind: "npc", id: "npc-9" };

  test("a theft is told by kind and outcome, of a thief", () => {
    expect(
      chronicleLine(
        theft({ kind: "lift", outcome: "won", witnessed: 0, worth: 34, coin: 34, settlement: 0 }, [
          npc,
        ]),
        NAMES,
      ),
    ).toBe("A thief lifted 34 coin from Old Tamsin at Ashford. Nobody saw who.");
    expect(
      chronicleLine(
        theft(
          {
            kind: "burgle",
            outcome: "won",
            witnessed: 1,
            worth: 30,
            units: 5,
            material: "scrap",
            faction: "faction:1",
            settlement: 4,
          },
          [{ kind: "faction", id: "f-1" }],
        ),
        NAMES,
      ),
    ).toBe(
      "A thief broke into Militia's store at Kell's Rest and took 5 goods of scrap, worth 30 coin. It was seen, and the watch is looking for them.",
    );
    expect(
      chronicleLine(
        theft({
          kind: "burgle",
          outcome: "won",
          witnessed: 0,
          worth: 12,
          units: 2,
          material: "scrap",
          faction: "faction:0",
          settlement: 0,
        }),
        NAMES,
      ),
    ).toBe(
      "A thief broke into Raider Compact's store at Ashford and took 2 goods of scrap, worth 12 coin. Nobody saw who.",
    );
    expect(
      chronicleLine(
        theft({
          kind: "waylay",
          outcome: "won",
          witnessed: 1,
          worth: 60,
          units: 12,
          side: "q-3",
          settlement: -1,
        }),
        NAMES,
      ),
    ).toBe(
      "A thief waylaid a caravan in Dunmarch and took 12 goods, worth 60 coin, for the side preying on the road. It was seen, and the watch is looking for them.",
    );
    expect(
      chronicleLine(
        theft({ kind: "lift", outcome: "lost", worth: 20, settlement: 0 }, [npc]),
        NAMES,
      ),
    ).toBe(
      "A thief was caught trying to lift from Old Tamsin at Ashford, and took nothing. The watch is looking for them.",
    );
    expect(chronicleLine(theft({ kind: "burgle", outcome: "empty", settlement: 0 }))).toBe(
      "A thief tried to break into a faction's store at a settlement, and found nothing to take.",
    );
    expect(
      chronicleLine(theft({ kind: "lift", outcome: "won", worth: 40, item: "i-41" }, [npc])),
    ).toBe("A thief lifted an item from a local, worth 40 coin. Nobody saw who.");
  });

  test("a betrayal names the faction only, and never the syndicate", () => {
    const betrayed = (faction: string, act: string, subjects: Ref[]): StoryFact => ({
      kind: "character.betrayed",
      subjects: [{ kind: "character", id: CHAR }, ...subjects],
      data: [
        { k: "faction", s: faction },
        { k: "act", s: act },
        { k: "standing", n: -50 },
      ],
    });
    expect(
      chronicleLine(betrayed("faction:1", "theft", [{ kind: "faction", id: "f-1" }]), NAMES),
    ).toBe("Militia was robbed by one it trusted, and will hold a grudge.");
    expect(chronicleLine(betrayed("faction:0", "theft", []), NAMES)).toBe(
      "Raider Compact was robbed by one it trusted, and will hold a grudge.",
    );
    expect(chronicleLine(betrayed("faction:3", "other", []))).toBe(
      "A faction was betrayed by one it trusted, and will hold a grudge.",
    );
    const static_ = {
      ...NAMES,
      ref: (r: Ref) => (r.id === "syndicate" ? "Static" : NAMES.ref?.(r)),
    };
    for (const subjects of [[], [{ kind: "faction", id: "syndicate" }]]) {
      const line = chronicleLine(betrayed("syndicate", "informed", subjects), static_);
      expect(line).toBe(
        "Someone the back rooms trusted turned on them, and they will not forget it.",
      );
      expect(line).not.toContain("Static");
    }
  });

  test("the watch running a thief down, and a thief in the walls", () => {
    expect(
      chronicleLine(
        {
          kind: "watch.caught",
          region: "r-2",
          subjects: [{ kind: "character", id: CHAR }],
          data: [
            { k: "settlement", n: 0 },
            { k: "worth", n: 25 },
          ],
        },
        NAMES,
      ),
    ).toBe(
      "The watch at Ashford ran down a fleeing thief and took back what was stolen, worth 25 coin.",
    );
    const trouble = (kind: string, d: Datum[]): StoryFact => ({
      kind,
      subjects: [],
      data: [{ k: "template", s: "thief-in-walls" }, { k: "settlement", n: 0 }, ...d],
    });
    expect(
      chronicleLine(trouble("trouble.started", [{ k: "mark:hold-it-off", n: 14 }]), NAMES),
    ).toBe("Thief in the walls at Ashford: 14 defence to hold it off by the day's end.");
    expect(chronicleLine(trouble("trouble.held", []), NAMES)).toBe(
      "Ashford held off the thief in the walls.",
    );
    expect(chronicleLine(trouble("trouble.lost", []))).toBe(
      "A settlement lost to the thief in the walls.",
    );
    expect(
      troubleBanner(
        { kind: "thief-in-walls", title: "", mark: 14, defence: 3, ends: 10 },
        { place: "Ashford" },
      ),
    ).toBe("Thief in the walls at Ashford: 3 of 14 defence to hold it off");
    expect(
      chronicleLine(trouble("trouble.held", []), {
        name: (sheet, id) => (sheet === "story.troubles" ? "The burglaries" : id),
      }),
    ).toBe("A settlement held off the burglaries.");
  });
});
